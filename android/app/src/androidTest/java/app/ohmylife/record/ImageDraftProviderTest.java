package app.ohmylife.record;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ImageDraftProviderTest {
    private Context context;
    @Before public void onlyIsolatedEmulator() throws Exception {
        try (ParcelFileDescriptor fd = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("getprop ro.boot.qemu.avd_name");
             InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
            assertEquals("设备验收只能运行在独立 Sync_UI 模拟器", "Sync_UI", new String(in.readAllBytes()).trim());
        }
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ImageDraftProvider.clear();
    }
    private Set<String> imageFiles() {
        String[] names = new File(context.getFilesDir(), "images").list();
        return new HashSet<>(Arrays.asList(names == null ? new String[0] : names));
    }
    private JSObject choose(File file) throws Exception {
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        JSArray images = ImageDraftProvider.prepare(context, Collections.singletonList(uri), ImageDraftProvider.generation());
        return JSObject.fromJSONObject(images.getJSONObject(0));
    }
    private Bitmap preview(String uri) throws Exception {
        try (InputStream in = context.getContentResolver().openInputStream(Uri.parse(uri))) { return BitmapFactory.decodeStream(in); }
    }
    private String sha(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) { byte[] buffer = new byte[65536]; int count; while ((count = in.read(buffer)) != -1) digest.update(buffer, 0, count); }
        StringBuilder result = new StringBuilder(); for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value & 255)); return result.toString();
    }

    @Test public void previewAndSaveRotatedPhotoWithoutDraftFiles() throws Exception {
        // 用真实 1200 万像素 JPEG 和 EXIF 旋转走完整原生链路。选图和两种预览均不得
        // 写入图片文件；保存后应等比得到 1536×2048、保留方向和颜色，并返回真实字节数和摘要。
        // 未被读取的预览管道也不能阻塞保存。模拟数据库回滚后用同一草稿重试，
        // 再删除相册源文件，确认保存本体独立可读。
        String id = "native-image-" + UUID.randomUUID();
        File original = new File(context.getCacheDir(), id + ".jpg"), saved = null;
        Set<String> before = imageFiles();
        try {
            Bitmap fixture = Bitmap.createBitmap(4000, 3000, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(fixture); Paint paint = new Paint();
            Random random = new Random(42);
            for (int y = 0; y < 3000; y += 8) for (int x = 0; x < 4000; x += 8) {
                int a = random.nextInt(128), b = random.nextInt(128), c = 180 + random.nextInt(75);
                paint.setColor(x < 2000 ? Color.rgb(c, a, b) : Color.rgb(a, b, c));
                canvas.drawRect(x, y, x + 8, y + 8, paint);
            }
            try (OutputStream out = new FileOutputStream(original)) { assertTrue(fixture.compress(Bitmap.CompressFormat.JPEG, 97, out)); }
            finally { fixture.recycle(); }
            ExifInterface exif = new ExifInterface(original.getPath());
            exif.setAttribute(ExifInterface.TAG_ORIENTATION, "6"); exif.saveAttributes();
            JSObject draft = choose(original);
            Bitmap small = preview(draft.getString("uri"));
            assertNotNull(small); assertEquals(240, small.getWidth()); assertEquals(320, small.getHeight()); small.recycle();
            Bitmap full = preview(draft.getString("previewUri"));
            assertNotNull(full); assertEquals(1536, full.getWidth()); assertEquals(2048, full.getHeight()); full.recycle();
            assertEquals("生成预览只使用内存管道", before, imageFiles());
            saved = new File(context.getFilesDir(), "images/" + id + ".webp");
            JSObject result;
            ExecutorService writer = Executors.newSingleThreadExecutor();
            try (InputStream unread = context.getContentResolver().openInputStream(Uri.parse(draft.getString("previewUri")))) {
                for (int i = 0; unread.available() == 0 && i < 200; i++) Thread.sleep(10);
                assertTrue("预览管道必须已开始输出", unread.available() > 0);
                Future<JSObject> write = writer.submit(() -> ImageDraftProvider.save(context, draft.getString("token"), id, context.getFilesDir()));
                result = write.get(5, TimeUnit.SECONDS);
            } finally { writer.shutdown(); writer.awaitTermination(10, TimeUnit.SECONDS); }
            assertTrue(saved.isFile()); assertEquals("image/webp", result.getString("mime"));
            assertTrue("编码结果必须超过管道缓冲区，才能覆盖预览阻塞场景", saved.length() > 65536);
            assertEquals(saved.length(), result.getLong("bytes")); assertEquals(sha(saved), result.getString("sha256"));
            assertTrue(saved.delete());
            JSObject retried = ImageDraftProvider.save(context, draft.getString("token"), id, context.getFilesDir());
            assertEquals(result.getString("sha256"), retried.getString("sha256"));
            ImageDraftProvider.release(draft.getString("token")); assertTrue(original.delete());
            Bitmap body = BitmapFactory.decodeFile(saved.getPath());
            assertNotNull(body); assertEquals(1536, body.getWidth()); assertEquals(2048, body.getHeight());
            assertTrue(Color.red(body.getPixel(768, 512)) > Color.blue(body.getPixel(768, 512)));
            assertTrue(Color.blue(body.getPixel(768, 1536)) > Color.red(body.getPixel(768, 1536))); body.recycle();
            try { context.getContentResolver().openInputStream(Uri.parse(draft.getString("uri"))); fail("释放草稿后不能继续读取引用"); }
            catch (FileNotFoundException expected) { /* 释放引用不删除已经保存的图片。 */ }
        } finally { original.delete(); if (saved != null) saved.delete(); ImageDraftProvider.clear(); }
        assertEquals(before, imageFiles());
    }

    @Test public void streamLimitsRemovePartialFilesAndKeepDraftRetryable() throws Exception {
        // 不可由原生解码的图片按原字节流保存。制造 17 MiB SVG 触发单张输出上限，
        // 预期完整文件和 .part 均不存在，草稿仍可再次尝试；取消后引用失效。
        // 再用稀疏文件验证 64 MiB 源文件上限在读取图片前就拒绝，不占用大数组。
        String id = "native-limit-" + UUID.randomUUID(); File original = new File(context.getCacheDir(), id + ".svg");
        Set<String> before = imageFiles();
        try {
            try (OutputStream out = new FileOutputStream(original)) {
                out.write("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><!--".getBytes());
                byte[] spaces = new byte[65536]; Arrays.fill(spaces, (byte) ' ');
                for (int i = 0; i < 17 * 16; i++) out.write(spaces);
                out.write("--></svg>".getBytes());
            }
            JSObject draft = choose(original);
            for (int attempt = 0; attempt < 2; attempt++) {
                try { ImageDraftProvider.save(context, draft.getString("token"), id, context.getFilesDir()); fail("必须拒绝超过单张输出上限的图片"); }
                catch (IOException expected) { assertTrue(expected.getMessage().contains("处理结果过大")); }
                assertEquals(before, imageFiles());
            }
            ImageDraftProvider.release(draft.getString("token"));
            try { ImageDraftProvider.save(context, draft.getString("token"), id, context.getFilesDir()); fail("取消后的引用必须失效"); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("已失效")); }
            try (RandomAccessFile file = new RandomAccessFile(original, "rw")) { file.setLength(64L * 1024 * 1024 + 1); }
            try { choose(original); fail("必须拒绝超大源文件"); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("单张图片过大")); }
        } finally { original.delete(); ImageDraftProvider.clear(); }
        assertEquals(before, imageFiles());
    }
}
