package app.ohmylife.record;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.os.ParcelFileDescriptor;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LauncherIconTest {
    @Test public void artworkHasWhiteMarginAtLauncherSizes() throws Exception {
        // 直接绘制系统读取的应用图标，覆盖常见桌面尺寸；彩色书本必须完整位于中心安全区，
        // 彩色图案的宽度至少占图标的 72%，避免白边过大；距任意边缘至少保留 10%，
        // 且位于圆形裁切边界内，避免不同桌面把书本截断。
        // 使用实际 Drawable 和像素测量，不能只检查 XML 中有没有 inset。
        try (ParcelFileDescriptor fd = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("getprop ro.boot.qemu.avd_name");
             InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
            assertEquals("仅在独立 Sync_UI 验收", "Sync_UI", new String(in.readAllBytes()).trim());
        }
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        float density = context.getResources().getDisplayMetrics().density;
        for (int dp : new int[]{48, 64, 96}) {
            int size = Math.round(dp * density);
            Drawable icon = context.getPackageManager().getApplicationIcon(context.getPackageName());
            Bitmap rendered = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            icon.setBounds(0, 0, size, size); icon.draw(new Canvas(rendered));
            int left = size, top = size, right = -1, bottom = -1, colors = 0;
            double radius = 0;
            for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
                int pixel = rendered.getPixel(x, y);
                int max = Math.max(Color.red(pixel), Math.max(Color.green(pixel), Color.blue(pixel)));
                int min = Math.min(Color.red(pixel), Math.min(Color.green(pixel), Color.blue(pixel)));
                if (Color.alpha(pixel) > 128 && max - min > 60) {
                    colors++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
                    radius = Math.max(radius, Math.hypot(x + .5 - size / 2., y + .5 - size / 2.));
                }
            }
            try (OutputStream out = new FileOutputStream(new File(context.getCacheDir(), "launcher-" + dp + ".png"))) { rendered.compress(Bitmap.CompressFormat.PNG, 100, out); }
            rendered.recycle();
            assertTrue("书本必须可见", colors > size * size / 10);
            String bounds = dp + "dp 书本范围 " + left + "," + top + "–" + right + "," + bottom + "，图标 " + size;
            assertTrue(bounds + " 白边过大", right - left + 1 >= size * .72);
            assertTrue(bounds, left >= size * .1 && top >= size * .1 && right < size * .9 && bottom < size * .9);
            assertTrue(bounds + " 圆形裁切留白不足", radius < size * .46);
        }
    }
}
