package app.ohmylife.record;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ColorSpace;
import android.graphics.ImageDecoder;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.system.Os;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 草稿只登记相册引用；预览通过管道生成，保存才写入图片本体。 */
public class ImageDraftProvider extends ContentProvider {
    static final int IMAGE_EDGE = 2048;
    private static final int QUALITY = 80;
    private static final long SOURCE_LIMIT = 64L * 1024 * 1024;
    private static final long OUTPUT_LIMIT = 16L * 1024 * 1024;
    private static final Map<String, Source> drafts = new HashMap<>();
    private static final Object codec = new Object();
    private static final ExecutorService previews = Executors.newFixedThreadPool(2);
    private static long generation;

    private static final class Source {
        final Uri uri;
        final String mime;
        final boolean decodable;
        Source(Uri uri, String mime, boolean decodable) { this.uri = uri; this.mime = mime; this.decodable = decodable; }
    }

    static synchronized long generation() { return generation; }
    static synchronized void clear() { generation++; synchronized (drafts) { drafts.clear(); } }
    static void release(String token) { synchronized (drafts) { drafts.remove(token); } }
    private static Source source(String token) throws IOException {
        synchronized (drafts) {
            Source source = drafts.get(token);
            if (source == null) throw new IOException("图片选择已失效，请重新选择");
            return source;
        }
    }
    private static InputStream input(Context context, Uri uri) throws IOException {
        InputStream stream = context.getContentResolver().openInputStream(uri);
        if (stream == null) throw new IOException("无法读取所选图片");
        return new BufferedInputStream(stream);
    }
    private static String extension(String mime) {
        switch (mime) {
            case "image/jpeg": return "jpg";
            case "image/png": return "png";
            case "image/webp": return "webp";
            case "image/gif": return "gif";
            case "image/heic": return "heic";
            case "image/heif": return "heif";
            case "image/avif": return "avif";
            case "image/svg+xml": return "svg";
            case "image/tiff": return "tiff";
            case "image/bmp": return "bmp";
            default: return "bin";
        }
    }
    private static String previewUri(Context context, String token, Source source, boolean full) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".image-drafts")
            .appendPath(token).appendPath(full ? "preview" : "thumbnail")
            .appendPath("image." + (source.decodable ? "webp" : extension(source.mime))).build().toString();
    }

    static JSArray prepare(Context context, List<Uri> uris, long expectedGeneration) throws Exception {
        Map<String, Source> selected = new LinkedHashMap<>();
        for (Uri uri : new LinkedHashSet<>(uris)) {
            if (!"content".equals(uri.getScheme())) throw new IOException("图片来源不正确");
            long bytes = -1;
            try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) bytes = cursor.getLong(0);
            }
            if (bytes < 0) {
                bytes = 0;
                try (InputStream in = input(context, uri)) {
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = in.read(buffer)) != -1) { bytes += count; if (bytes > SOURCE_LIMIT) break; }
                }
            }
            if (bytes > SOURCE_LIMIT) throw new IOException("单张图片过大，请先缩小图片");
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            try (InputStream in = input(context, uri)) { BitmapFactory.decodeStream(in, null, bounds); }
            String mime = context.getContentResolver().getType(uri);
            if (mime == null) mime = bounds.outMimeType;
            if (mime == null || !mime.startsWith("image/")) throw new IOException("无法识别图片格式");
            selected.put(UUID.randomUUID().toString(), new Source(uri, mime, bounds.outWidth > 0 && bounds.outHeight > 0));
        }
        JSArray result = new JSArray();
        synchronized (ImageDraftProvider.class) {
            if (generation != expectedGeneration) return result;
            synchronized (drafts) { drafts.putAll(selected); }
            for (Map.Entry<String, Source> item : selected.entrySet()) result.put(new JSObject().put("token", item.getKey())
                .put("uri", previewUri(context, item.getKey(), item.getValue(), false))
                .put("previewUri", previewUri(context, item.getKey(), item.getValue(), true)));
        }
        return result;
    }

    private static Bitmap decode(Context context, Source source, int edge) throws IOException {
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                return ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.getContentResolver(), source.uri), (decoder, info, origin) -> {
                    int width = info.getSize().getWidth(), height = info.getSize().getHeight();
                    double scale = Math.min(1, (double) edge / Math.max(width, height));
                    decoder.setTargetSize(Math.max(1, (int) Math.round(width * scale)), Math.max(1, (int) Math.round(height * scale)));
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                    decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB));
                });
            } catch (ImageDecoder.DecodeException error) { throw new IOException("无法解码所选图片", error); }
        }
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
        try (InputStream in = input(context, source.uri)) { BitmapFactory.decodeStream(in, null, options); }
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > edge) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false;
        Bitmap bitmap;
        try (InputStream in = input(context, source.uri)) { bitmap = BitmapFactory.decodeStream(in, null, options); }
        if (bitmap == null) throw new IOException("无法解码所选图片");
        try (InputStream in = input(context, source.uri)) {
            int orientation = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1);
            android.graphics.Matrix matrix = new android.graphics.Matrix();
            switch (orientation) {
                case 2: matrix.setScale(-1, 1); break;
                case 3: matrix.setRotate(180); break;
                case 4: matrix.setScale(1, -1); break;
                case 5: matrix.setRotate(90); matrix.postScale(-1, 1); break;
                case 6: matrix.setRotate(90); break;
                case 7: matrix.setRotate(270); matrix.postScale(-1, 1); break;
                case 8: matrix.setRotate(270); break;
            }
            if (!matrix.isIdentity()) {
                Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                if (oriented != bitmap) { bitmap.recycle(); bitmap = oriented; }
            }
        } catch (IOException ignored) { /* 无 EXIF 的图片按像素方向显示。 */ }
        return bitmap;
    }
    private static Bitmap.CompressFormat format() {
        return Build.VERSION.SDK_INT >= 30 ? Bitmap.CompressFormat.WEBP_LOSSY : Bitmap.CompressFormat.WEBP;
    }
    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[65536]; int count;
        while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
    }

    private static final class ImageOutput extends FilterOutputStream {
        final MessageDigest digest;
        long bytes;
        ImageOutput(OutputStream out) throws Exception { super(out); digest = MessageDigest.getInstance("SHA-256"); }
        @Override public void write(int value) throws IOException { write(new byte[]{(byte) value}, 0, 1); }
        @Override public void write(byte[] buffer, int offset, int count) throws IOException {
            if (bytes + count > OUTPUT_LIMIT) throw new IOException("单张图片处理结果过大，请缩小图片");
            out.write(buffer, offset, count); digest.update(buffer, offset, count); bytes += count;
        }
    }

    static JSObject save(Context context, String token, String id, File root) throws Exception {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,128}")) throw new IOException("图片标识不正确");
        synchronized (codec) {
            Source source = source(token);
            Bitmap bitmap = null; File partial = null;
            try {
                if (source.decodable) bitmap = decode(context, source, IMAGE_EDGE);
                String mime = bitmap == null ? source.mime : "image/webp";
                String path = "images/" + id + "." + extension(mime);
                File target = new File(root, path), directory = target.getParentFile();
                if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) throw new IOException("无法创建文件目录");
                if (target.exists()) throw new IOException("图片标识已经存在");
                partial = new File(target.getPath() + ".part");
                long bytes; byte[] digest;
                try (FileOutputStream file = new FileOutputStream(partial); ImageOutput out = new ImageOutput(file)) {
                    if (bitmap != null) {
                        if (!bitmap.compress(format(), QUALITY, out)) throw new IOException("图片压缩失败");
                    } else try (InputStream in = input(context, source.uri)) { copy(in, out); }
                    out.flush(); file.getFD().sync(); bytes = out.bytes; digest = out.digest.digest();
                }
                StringBuilder hash = new StringBuilder();
                for (byte value : digest) hash.append(String.format(Locale.ROOT, "%02x", value & 255));
                synchronized (drafts) {
                    if (drafts.get(token) != source) throw new IOException("图片选择已失效，请重新选择");
                    Os.rename(partial.getPath(), target.getPath());
                }
                return new JSObject().put("path", path).put("bytes", bytes).put("sha256", hash.toString()).put("mime", mime);
            } catch (OutOfMemoryError error) { throw new IOException("图片处理内存不足，请减少同时预览的图片", error); }
            finally { if (bitmap != null) bitmap.recycle(); if (partial != null) partial.delete(); }
        }
    }

    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) {
        try { Source source = source(uri.getPathSegments().get(0)); return source.decodable ? "image/webp" : source.mime; }
        catch (IOException | IndexOutOfBoundsException error) { return null; }
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        List<String> parts = uri.getPathSegments();
        if (!mode.equals("r") || parts.size() != 3 || !(parts.get(1).equals("thumbnail") || parts.get(1).equals("preview"))) throw new FileNotFoundException("图片预览地址不正确");
        String token = parts.get(0); boolean full = parts.get(1).equals("preview");
        try {
            source(token);
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            previews.execute(() -> {
                try (OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
                    Source source = source(token);
                    if (source.decodable) {
                        Bitmap bitmap;
                        synchronized (codec) { bitmap = decode(getContext(), source(token), full ? IMAGE_EDGE : 320); }
                        // 管道写入受读取方控制，不占用保存图片所需的解码锁。
                        try { if (!bitmap.compress(format(), full ? QUALITY : 80, out)) throw new IOException("图片预览生成失败"); }
                        finally { bitmap.recycle(); }
                    } else try (InputStream in = input(getContext(), source.uri)) { copy(in, out); }
                } catch (Exception | OutOfMemoryError ignored) { /* 关闭的管道使图片元素进入可重试状态。 */ }
            });
            return pipe[0];
        } catch (IOException error) { throw new FileNotFoundException(error.getMessage()); }
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
