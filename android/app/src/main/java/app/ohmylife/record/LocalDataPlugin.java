package app.ohmylife.record;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.StatFs;
import android.system.Os;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import android.view.WindowManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;
import okio.BufferedSink;

/** 数据库写入串行化；传输只写独立工作文件，提交时验证同步操作。 */
@CapacitorPlugin(name = "LocalData")
public class LocalDataPlugin extends Plugin {
    private static final int NETWORK_TIMEOUT_SECONDS = 15;
    private final ExecutorService dataQueue = Executors.newSingleThreadExecutor();
    private final ExecutorService filesQueue = Executors.newFixedThreadPool(2);
    private final Object guard = new Object();
    private final Object thumbnailGuard = new Object();
    private final Map<String, Long> progressTimes = new ConcurrentHashMap<>();
    private final Map<Call, String> calls = new ConcurrentHashMap<>();
    private final OkHttpClient networkHttp = new OkHttpClient.Builder().connectTimeout(NETWORK_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(NETWORK_TIMEOUT_SECONDS, TimeUnit.SECONDS).writeTimeout(NETWORK_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .callTimeout(NETWORK_TIMEOUT_SECONDS, TimeUnit.SECONDS).followRedirects(false).build();
    private final OkHttpClient fileHttp = networkHttp.newBuilder().callTimeout(3, TimeUnit.MINUTES).build();
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor();
    private volatile long lastActivity;
    private volatile String activeOperation;
    private boolean pickingImages;

    @Override public void load() {
        watchdog.scheduleAtFixedRate(() -> {
            String operation = activeOperation;
            if (operation != null && android.os.SystemClock.elapsedRealtime() - lastActivity > 45_000) finishOperation(operation);
        }, 5, 5, TimeUnit.SECONDS);
    }
    private void finishOperation(String operation) {
        synchronized (guard) {
            if (!Objects.equals(operation, activeOperation)) return;
            activeOperation = null;
        }
        for (Map.Entry<Call, String> entry : calls.entrySet()) if (Objects.equals(entry.getValue(), operation)) entry.getKey().cancel();
        getActivity().runOnUiThread(() -> {
            if (activeOperation == null) getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }
    private SQLiteDatabase database;
    private File root;
    private File databaseFile;

    private interface Work { JSObject run() throws Exception; }
    private void run(ExecutorService queue, PluginCall call, Work work) {
        queue.execute(() -> { if (activeOperation != null) lastActivity = android.os.SystemClock.elapsedRealtime(); try { call.resolve(work.run()); } catch (Exception error) { call.reject(error.getMessage(), error); } });
    }
    private void check(String operation, boolean write) throws Exception {
        if (operation != null && !operation.equals(activeOperation)) throw new IOException("同步操作已失效");
        if (operation != null) lastActivity = android.os.SystemClock.elapsedRealtime();
        if (write && activeOperation != null && !activeOperation.equals(operation)) throw new IOException("同步期间不能写入");
    }
    private File file(String path) throws Exception {
        if (path == null || path.isEmpty()) throw new IOException("文件路径为空");
        File candidate = new File(root, path).getCanonicalFile();
        if (!candidate.getPath().startsWith(root.getCanonicalPath() + File.separator)) throw new IOException("文件路径超出应用目录");
        return candidate;
    }
    private void parent(File file) throws IOException {
        File directory = file.getParentFile();
        if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) throw new IOException("无法创建文件目录");
    }
    private void openDatabase() {
        database = SQLiteDatabase.openOrCreateDatabase(databaseFile, null);
        database.setForeignKeyConstraintsEnabled(true);
        try (Cursor cursor = database.rawQuery("PRAGMA busy_timeout=5000", null)) { cursor.moveToFirst(); }
        database.enableWriteAheadLogging();
        if (database.getVersion() == 1) ensureTemplateCreatedAt();
    }
    private void ensureTemplateCreatedAt() {
        database.beginTransaction();
        try {
            boolean hasCreatedAt = false;
            try (Cursor columns = database.rawQuery("PRAGMA table_info(type_templates)", null)) {
                while (columns.moveToNext()) if ("created_at".equals(columns.getString(columns.getColumnIndexOrThrow("name")))) hasCreatedAt = true;
            }
            if (!hasCreatedAt) database.execSQL("ALTER TABLE type_templates ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0");
            database.execSQL("UPDATE type_templates SET created_at=946684800000+rowid WHERE created_at=0");
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
    }
    private JSObject info(String path, boolean digest) throws Exception {
        File source = file(path);
        if (!source.isFile()) return null;
        String hash = "";
        if (digest) {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new FileInputStream(source)) {
                byte[] buffer = new byte[65536]; int count;
                while ((count = in.read(buffer)) != -1) sha.update(buffer, 0, count);
            }
            StringBuilder text = new StringBuilder();
            for (byte value : sha.digest()) text.append(String.format(Locale.ROOT, "%02x", value & 255));
            hash = text.toString();
        }
        return new JSObject().put("path", path).put("bytes", source.length()).put("sha256", hash);
    }
    private JSArray queryRows(SQLiteDatabase db, String sql, JSONArray params) throws Exception {
        String[] args = new String[params.length()];
        for (int i = 0; i < args.length; i++) args[i] = params.isNull(i) ? null : params.get(i).toString();
        JSArray rows = new JSArray();
        try (Cursor cursor = db.rawQuery(sql, args)) {
            while (cursor.moveToNext()) {
                JSObject row = new JSObject();
                for (int i = 0; i < cursor.getColumnCount(); i++) {
                    Object value;
                    switch (cursor.getType(i)) {
                        case Cursor.FIELD_TYPE_NULL: value = JSONObject.NULL; break;
                        case Cursor.FIELD_TYPE_INTEGER: value = cursor.getLong(i); break;
                        case Cursor.FIELD_TYPE_FLOAT: value = cursor.getDouble(i); break;
                        default: value = cursor.getString(i);
                    }
                    row.put(cursor.getColumnName(i), value);
                }
                rows.put(row);
            }
        }
        return rows;
    }
    @PluginMethod public void initialize(PluginCall call) {
        run(dataQueue, call, () -> {
            ImageDraftProvider.clear();
            root = getContext().getFilesDir();
            databaseFile = getContext().getDatabasePath("life.sqlite");
            parent(databaseFile);
            if (activeOperation != null) finishOperation(activeOperation);
            if (database != null && database.isOpen()) database.close();
            recoverReceipt();
            openDatabase();
            int version = database.getVersion();
            if (version != 0 && version != 1) throw new IOException("数据库版本不支持");
            if (version == 0) {
                try (Cursor tables = database.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'android_%' AND name NOT LIKE 'sqlite_%'", null)) {
                    if (tables.moveToFirst()) throw new IOException("数据库格式无法识别");
                }
                database.beginTransaction();
                try {
                    String schema = call.getString("schema", "");
                    for (String statement : schema.split(";")) if (!statement.trim().isEmpty()) database.execSQL(statement);
                    database.setTransactionSuccessful();
                } finally { database.endTransaction(); }
            }
            JSObject preferences = new JSObject();
            for (Map.Entry<String, ?> entry : getContext().getSharedPreferences("settings", 0).getAll().entrySet()) preferences.put(entry.getKey(), String.valueOf(entry.getValue()));
            return new JSObject().put("preferences", preferences);
        });
    }
    @PluginMethod public void query(PluginCall call) {
        run(dataQueue, call, () -> {
            String path = call.getString("path");
            if (path == null) return new JSObject().put("rows", queryRows(database, call.getString("sql"), call.getArray("values", new JSArray())));
            try (SQLiteDatabase other = SQLiteDatabase.openDatabase(file(path).getPath(), null, SQLiteDatabase.OPEN_READONLY)) {
                return new JSObject().put("rows", queryRows(other, call.getString("sql"), call.getArray("values", new JSArray())));
            }
        });
    }
    @PluginMethod public void execute(PluginCall call) {
        run(dataQueue, call, () -> {
            synchronized (guard) {
                check(call.getString("operationId"), true);
                database.beginTransaction();
                try {
                    JSONArray statements = call.getArray("statements", new JSArray());
                    for (int i = 0; i < statements.length(); i++) {
                        JSONObject item = statements.getJSONObject(i);
                        JSONArray args = item.optJSONArray("values");
                        Object[] values = new Object[args == null ? 0 : args.length()];
                        for (int j = 0; j < values.length; j++) values[j] = args.isNull(j) ? null : args.get(j);
                        database.execSQL(item.getString("sql"), values);
                    }
                    database.setTransactionSuccessful();
                } finally { database.endTransaction(); }
            }
            return new JSObject();
        });
    }
    private void writeReceipt(JSObject receipt, String path) throws Exception {
        JSObject journal = new JSObject().put("path", path).put("key", receipt.getString("key")).put("value", receipt.getString("value"));
        File target = file("restore-receipt.json");
        File partial = file("restore-receipt.json.part");
        try (FileOutputStream out = new FileOutputStream(partial)) { out.write(journal.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); out.getFD().sync(); }
        Os.rename(partial.getPath(), target.getPath());
    }
    /** 快照源文件消失表示数据库替换已提交；先补写回执，再开放应用。 */
    private void recoverReceipt() throws Exception {
        File journal = file("restore-receipt.json");
        if (!journal.isFile()) return;
        String text;
        try (InputStream in = new FileInputStream(journal); ByteArrayOutputStream out = new ByteArrayOutputStream()) { copy(in, out); text = out.toString("UTF-8"); }
        JSONObject receipt = new JSONObject(text);
        if (!file(receipt.getString("path")).exists()) {
            if (!getContext().getSharedPreferences("settings", 0).edit().putString(receipt.getString("key"), receipt.getString("value")).commit()) throw new IOException("恢复回执保存失败");
        }
        if (!journal.delete()) throw new IOException("恢复回执无法完成");
    }
    @PluginMethod public void readPreference(PluginCall call) {
        run(dataQueue, call, () -> {
            recoverReceipt();
            String value = getContext().getSharedPreferences("settings", 0).getString(call.getString("key"), null);
            return new JSObject().put("value", value == null ? JSONObject.NULL : value);
        });
    }
    private void removeTree(File directory) throws IOException {
        File[] children = directory.listFiles();
        if (children != null) for (File child : children) removeTree(child);
        if (directory.exists() && !directory.delete()) throw new IOException("工作文件无法回收");
    }
    @PluginMethod public void prepareTransfer(PluginCall call) {
        run(dataQueue, call, () -> {
            synchronized (guard) {
                check(call.getString("operationId"), true);
                String folder = call.getString("folder");
                if (folder == null || !folder.matches("[a-f0-9-]+")) throw new IOException("工作目录不正确");
                File[] entries = file("transfers").listFiles();
                if (entries != null) for (File entry : entries) if (!entry.getName().equals(folder)) removeTree(entry);
            }
            return new JSObject();
        });
    }
    @PluginMethod public void preference(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        android.content.SharedPreferences.Editor edit = getContext().getSharedPreferences("settings", 0).edit();
        if (value == null) edit.remove(key); else edit.putString(key, value);
        if (edit.commit()) call.resolve(); else call.reject("设备设置保存失败");
    }
    @PluginMethod public void beginSync(PluginCall call) {
        synchronized (guard) {
            if (activeOperation != null) { call.reject("已有同步任务执行中"); return; }
            activeOperation = call.getString("operationId");
            lastActivity = android.os.SystemClock.elapsedRealtime();
        }
        getActivity().runOnUiThread(() -> getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        call.resolve();
    }
    @PluginMethod public void endSync(PluginCall call) {
        finishOperation(call.getString("operationId"));
        call.resolve();
    }
    @PluginMethod public void snapshot(PluginCall call) {
        run(dataQueue, call, () -> {
            String operation = call.getString("operationId");
            check(operation, true);
            String path = "transfers/" + operation + "/database.sqlite";
            File target = file(path); parent(target);
            database.close();
            try (InputStream in = new FileInputStream(databaseFile); OutputStream out = new FileOutputStream(target)) { copy(in, out); }
            finally { openDatabase(); }
            check(operation, false);
            return info(path, true);
        });
    }
    private void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[65536]; int count;
        while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
    }
    @PluginMethod public void pickImages(PluginCall call) {
        synchronized (guard) {
            if (activeOperation != null) { call.reject("同步期间不能选择图片"); return; }
            if (pickingImages) { call.reject("图片选择正在进行中"); return; }
            pickingImages = true;
            call.getData().put("generation", ImageDraftProvider.generation());
        }
        try {
            Intent intent = new ActivityResultContracts.PickMultipleVisualMedia().createIntent(getContext(),
                new PickVisualMediaRequest.Builder().setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE).build());
            startActivityForResult(call, intent, "imagesPicked");
        }
        catch (Exception error) { synchronized (guard) { pickingImages = false; } call.reject(error.getMessage(), error); }
    }
    @ActivityCallback private void imagesPicked(PluginCall call, ActivityResult result) {
        synchronized (guard) { pickingImages = false; }
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("images", new JSArray())); return; }
        List<Uri> uris = new ArrayList<>();
        Intent intent = result.getData();
        if (intent.getClipData() != null) for (int i = 0; i < intent.getClipData().getItemCount(); i++) uris.add(intent.getClipData().getItemAt(i).getUri());
        else if (intent.getData() != null) uris.add(intent.getData());
        long generation = call.getData().optLong("generation", -1);
        run(filesQueue, call, () -> new JSObject().put("images", ImageDraftProvider.prepare(getContext(), uris, generation)));
    }
    @PluginMethod public void releaseImages(PluginCall call) {
        JSONArray tokens = call.getArray("tokens", new JSArray());
        for (int i = 0; i < tokens.length(); i++) ImageDraftProvider.release(tokens.optString(i));
        call.resolve();
    }
    @PluginMethod public void writeImage(PluginCall call) {
        run(filesQueue, call, () -> {
            synchronized (guard) {
                check(null, true);
                return ImageDraftProvider.save(getContext(), call.getString("token"), call.getString("id"), root);
            }
        });
    }
    @PluginMethod public void fileInfo(PluginCall call) {
        run(filesQueue, call, () -> new JSObject().put("file", info(call.getString("path"), call.getBoolean("verify", false))));
    }
    @PluginMethod public void imageSource(PluginCall call) {
        run(filesQueue, call, () -> {
            String path = call.getString("path");
            if (!path.startsWith("images/")) throw new IOException("图片路径不正确");
            File source = file(path);
            if (!source.isFile()) throw new IOException("本地图片不存在");
            boolean thumbnail = call.getBoolean("thumbnail", false);
            String extension = source.getName().substring(source.getName().lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
            boolean converted = Arrays.asList("heic", "heif", "tif", "tiff").contains(extension);
            if (thumbnail || converted) {
                synchronized (thumbnailGuard) {
                    File target = new File(getContext().getCacheDir(), (thumbnail ? "thumbnails/" : "previews/") + source.getName() + ".webp");
                    if (!target.isFile()) {
                        parent(target);
                        BitmapFactory.Options options = new BitmapFactory.Options();
                        options.inJustDecodeBounds = true;
                        BitmapFactory.decodeFile(source.getPath(), options);
                        options.inSampleSize = 1;
                        int maxEdge = thumbnail ? 320 : 2048;
                        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > maxEdge * 2) options.inSampleSize *= 2;
                        options.inJustDecodeBounds = false;
                        Bitmap bitmap = BitmapFactory.decodeFile(source.getPath(), options);
                        if (bitmap == null) return new JSObject().put("uri", "file://" + source.getAbsolutePath());
                        try {
                            try {
                                android.media.ExifInterface exif = new android.media.ExifInterface(source.getPath());
                                int orientation = exif.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1);
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
                            } catch (IOException ignored) {}
                            double scale = Math.min(1, (double) maxEdge / Math.max(bitmap.getWidth(), bitmap.getHeight()));
                            Bitmap small = Bitmap.createScaledBitmap(bitmap, Math.max(1,(int)(bitmap.getWidth()*scale)), Math.max(1,(int)(bitmap.getHeight()*scale)), true);
                            File temporary = new File(target.getPath()+".part");
                            try (OutputStream out = new FileOutputStream(temporary)) {
                                if (!small.compress(Bitmap.CompressFormat.WEBP, 80, out)) throw new IOException("缩略图生成失败");
                            } finally { if (small != bitmap) small.recycle(); }
                            Os.rename(temporary.getPath(), target.getPath());
                        } finally { bitmap.recycle(); }
                    }
                    source = target;
                }
            }
            return new JSObject().put("uri", "file://" + source.getAbsolutePath());
        });
    }
    @PluginMethod public void removeFiles(PluginCall call) {
        run(dataQueue, call, () -> {
            synchronized (guard) {
                check(call.getString("operationId"), true);
                JSONArray paths = call.getArray("paths", new JSArray());
                for (int i=0; i<paths.length(); i++) removeImage(paths.getString(i));
            }
            return new JSObject();
        });
    }
    private void removeImage(String path) throws Exception {
        if (!path.startsWith("images/")) throw new IOException("图片路径不正确");
        File source=file(path);
        if (source.exists() && !source.delete()) throw new IOException("图片删除失败");
        new File(getContext().getCacheDir(),"thumbnails/"+source.getName()+".webp").delete();
        new File(getContext().getCacheDir(),"previews/"+source.getName()+".webp").delete();
    }
    private void align(JSONArray paths) throws Exception {
        Set<String> expected=new HashSet<>();
        for (int i=0;i<paths.length();i++) expected.add(paths.getString(i));
        File[] files=file("images").listFiles();
        if (files!=null) for (File image:files) if (image.isFile() && !expected.contains("images/"+image.getName())) removeImage("images/"+image.getName());
    }
    @PluginMethod public void alignImages(PluginCall call) {
        run(dataQueue,call,()->{ synchronized(guard) { check(call.getString("operationId"),true); align(call.getArray("paths",new JSArray())); } return new JSObject(); });
    }
    @PluginMethod public void activate(PluginCall call) {
        run(dataQueue,call,()->{
            synchronized(guard) {
                check(call.getString("operationId"),true);
                String path=call.getString("path");
                File snapshot=file(path);
                try(SQLiteDatabase checkDb=SQLiteDatabase.openDatabase(snapshot.getPath(),null,SQLiteDatabase.OPEN_READONLY)) {
                    if(checkDb.getVersion()!=1) throw new IOException("数据库版本不支持");
                    try(Cursor cursor=checkDb.rawQuery("PRAGMA integrity_check",null)) { if(!cursor.moveToFirst()||!"ok".equals(cursor.getString(0))) throw new IOException("数据库完整性校验失败"); }
                }
                writeReceipt(call.getObject("receipt"), path);
                JSONArray images=call.getArray("images",new JSArray());
                File directory=snapshot.getParentFile();
                for(int i=0;i<images.length();i++) {
                    String imagePath=images.getString(i);
                    if(!imagePath.startsWith("images/")) throw new IOException("图片路径不正确");
                    File target=file(imagePath); File incoming=new File(directory,imagePath);
                    if(incoming.isFile()) { parent(target); Os.rename(incoming.getPath(),target.getPath()); }
                    if(!target.isFile()) throw new IOException("恢复图片缺失");
                }
                database.close();
                try {
                    for (String suffix : new String[]{"-wal", "-shm", "-journal"}) {
                        File journal = new File(databaseFile.getPath() + suffix);
                        if (journal.exists() && !journal.delete()) throw new IOException("数据库日志无法释放");
                    }
                    Os.rename(snapshot.getPath(), databaseFile.getPath());
                } finally { openDatabase(); }
                recoverReceipt();
                align(images);
            }
            return new JSObject();
        });
    }
    @PluginMethod public void adoptImage(PluginCall call) {
        run(dataQueue,call,()->{
            synchronized(guard) {
                check(call.getString("operationId"),true);
                String path=call.getString("path");
                if(!path.startsWith("images/")) throw new IOException("图片路径不正确");
                File source=file(call.getString("source"));File target=file(path);parent(target);
                Os.rename(source.getPath(),target.getPath());
            }
            return new JSObject();
        });
    }
    @PluginMethod public void availableSpace(PluginCall call) { call.resolve(new JSObject().put("bytes",new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes())); }

    @PluginMethod public void network(PluginCall pluginCall) {
        run(filesQueue,pluginCall,()->{
            String operation=pluginCall.getString("operationId"); check(operation,false);
            String url=pluginCall.getString("url");
            if(!url.startsWith("https://")&&(getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) throw new IOException("云端连接必须使用 HTTPS");
            String method=pluginCall.getString("method","GET");
            Request.Builder builder=new Request.Builder().url(url);
            JSObject headers=pluginCall.getObject("headers",new JSObject());
            Iterator<String> keys=headers.keys(); while(keys.hasNext()) { String key=keys.next(); builder.header(key,headers.getString(key)); }
            String source=pluginCall.getString("source");
            String destination=pluginCall.getString("destination");
            RequestBody body=null;
            if(source!=null) {
                File input=file(source);
                body=new RequestBody() {
                    public MediaType contentType() { return null; }
                    public long contentLength() { return input.length(); }
                    public void writeTo(BufferedSink sink) throws IOException {
                        try(InputStream in=new FileInputStream(input)) {
                            byte[] buffer=new byte[65536]; int count; long sent=0;
                            while((count=in.read(buffer))!=-1) { sink.write(buffer,0,count); sent+=count; progress(pluginCall,sent,input.length()); }
                        }
                    }
                };
            } else if(method.equals("PUT")||method.equals("POST")) body=RequestBody.create(new byte[0],null);
            builder.method(method,body);
            Call call=(source!=null||destination!=null?fileHttp:networkHttp).newCall(builder.build()); calls.put(call,operation==null?"":operation);
            try(Response response=call.execute()) {
                JSObject result=new JSObject().put("status",response.code());
                JSObject returnedHeaders=new JSObject();
                for(String key:response.headers().names()) returnedHeaders.put(key.toLowerCase(Locale.ROOT),response.header(key));
                result.put("headers",returnedHeaders);
                ResponseBody responseBody=response.body();
                if(response.isSuccessful()&&destination!=null&&responseBody!=null) {
                    if(!destination.startsWith("transfers/")) throw new IOException("下载目录不正确");
                    File target=file(destination);parent(target);
                    File partial=new File(target.getPath()+".part");
                    try(InputStream in=responseBody.byteStream(); FileOutputStream out=new FileOutputStream(partial)) {
                        byte[] buffer=new byte[65536];int count;long received=0;
                        while((count=in.read(buffer))!=-1) { out.write(buffer,0,count);received+=count;progress(pluginCall,received,responseBody.contentLength()); }
                        out.getFD().sync();
                    }
                    check(operation,false);
                    String relative=destination+".part";
                    JSObject details=info(relative,true);
                    String expected=pluginCall.getString("expectedSha256");
                    if(expected!=null&&!expected.equals(details.getString("sha256"))) { partial.delete(); throw new IOException("文件内容摘要不匹配"); }
                    synchronized(guard) { check(operation,false); Os.rename(partial.getPath(),target.getPath()); }
                    details.put("path",destination); result.put("file",details);result.put("body","");
                } else {
                    ByteArrayOutputStream text = new ByteArrayOutputStream();
                    if (responseBody != null) try (InputStream in = responseBody.byteStream()) {
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = in.read(buffer)) != -1) {
                            if (text.size() + count > 4 * 1024 * 1024) throw new IOException("云端响应过大");
                            text.write(buffer, 0, count);
                        }
                    }
                    result.put("body", text.toString("UTF-8"));
                }
                return result;
            } finally { calls.remove(call); progressTimes.remove(pluginCall.getCallbackId()); }
        });
    }
    private void progress(PluginCall call,long bytes,long total) {
        String operation=call.getString("operationId");
        if (operation != null && operation.equals(activeOperation)) {
            long now = android.os.SystemClock.elapsedRealtime(); lastActivity = now;
            Long previous = progressTimes.get(call.getCallbackId());
            if (bytes != total && previous != null && now - previous < 100) return;
            progressTimes.put(call.getCallbackId(), now);
            notifyListeners("transferProgress", new JSObject().put("operationId", operation).put("key", call.getString("key", "")).put("bytes", bytes).put("total", total));
        }
    }
    @Override protected void handleOnDestroy() {
        ImageDraftProvider.clear();
        activeOperation=null;
        watchdog.shutdownNow();
        for(Call call:calls.keySet())call.cancel();
        networkHttp.dispatcher().executorService().shutdown();
        filesQueue.shutdownNow();
        dataQueue.execute(() -> { if (database != null && database.isOpen()) database.close(); });
        dataQueue.shutdown();
    }
}
