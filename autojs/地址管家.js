/**
 * 地址管家 v2  (AutoX.js / AutoJS Pro)
 * ----------------------------------------------------------------------------
 * 目标：一个脚本干完三件事
 *   ① 自动列出你手机里所有购物类 App（回答"我有多少个购物软件"）
 *   ② 逐个进去收货地址页，读出全部地址，判断默认地址对不对
 *   ③ 若地址簿里已有新地址、只是没设成默认 → 自动点"设为默认"
 *
 * 安全设计（重要）：
 *   - 绝不删除、绝不编辑地址文本，只做"设为默认"这一个低风险动作
 *   - 点"设为默认"之前逐条弹窗确认，且只在"新地址所在那一行"点击
 *   - 找不到新地址所在行时，宁可不动手，只报出来让你自己改
 */

// ==================== ① 配置 ====================

var NEW_KEYWORDS = [
    "新城区",
    "新城路",
    "示例小区"
];

var OLD_KEYWORDS = [
    "老城区",
    "老城路"
];

var ALLOW_AUTO_SET_DEFAULT = true;
var CONFIRM_EACH_CLICK = true;

var APP_NAME_PATTERN = "淘宝|天猫|京东|拼多多|抖音|快手|唯品|小红|得物|苏宁|美团|饿了|1688|严选|商城|购物|有赞|微店|盒马|叮咚|朴朴";
var PAGE_HINTS = ["收货地址", "地址管理", "新增地址", "管理收货地址", "地址簿", "收货信息"];

var WAIT_PER_APP_MS = 150000;
var MANUAL_FALLBACK_MS = 120000;

var OUT_DIR = "/sdcard/地址巡检/";
var dateStr = new java.text.SimpleDateFormat("yyyyMMdd_HHmm").format(new java.util.Date());

var INSTALLED = [];
var RESULT = [];

// ==================== ② 工具函数 ====================

function log(m) { console.log(m); }

function texts() {
    var arr = [];
    try {
        var vs = className("android.widget.TextView").find();
        for (var i = 0; i < vs.size(); i++) {
            var t = vs.get(i).text();
            if (t && t.length > 0) arr.push(t);
        }
        var es = className("android.widget.EditText").find();
        for (var j = 0; j < es.size(); j++) {
            var t2 = es.get(j).text();
            if (t2 && t2.length > 0) arr.push(t2);
        }
    } catch (e) { }
    return arr;
}

function joinedText() { return texts().join(" | "); }

function hits(str, kws) {
    var r = [];
    for (var i = 0; i < kws.length; i++) if (kws[i] && str.indexOf(kws[i]) >= 0) r.push(kws[i]);
    return r;
}

function onAddressPage() {
    var t = joinedText();
    if (hits(t, PAGE_HINTS).length === 0) return false;
    return /1[3-9]\d{9}/.test(t) || t.indexOf("收件人") >= 0 || t.indexOf("默认") >= 0 ||
        (t.indexOf("省") >= 0 && t.indexOf("区") >= 0);
}

function tapTextView(textMatch) {
    try {
        var w = textContains(textMatch).findOnce();
        if (!w) return false;
        var b = w.bounds();
        click(b.centerX(), b.centerY());
        return true;
    } catch (e) { return false; }
}

function clickSetDefaultInRow(rowY) {
    var cands = [];
    var patterns = ["设为默认", "设为默认地址", "设置为默认"];
    for (var p = 0; p < patterns.length; p++) {
        var list = textContains(patterns[p]).find();
        for (var i = 0; i < list.size(); i++) cands.push(list.get(i));
    }
    for (var k = 0; k < cands.length; k++) {
        var b = cands[k].bounds();
        if (Math.abs(b.centerY() - rowY) <= 110) {
            click(b.centerX(), b.centerY());
            return true;
        }
    }
    return false;
}

function csvCell(s) {
    if (s === null || s === undefined) return "";
    return '"' + String(s).replace(/"/g, '""') + '"';
}

function maskPhone(s) {
    return String(s).replace(/1[3-9]\d{9}/g, function (m) {
        return m.substring(0, 3) + "****" + m.substring(7);
    });
}

// ==================== ③ 枚举购物 App ====================

function listShoppingApps() {
    var out = [];
    try {
        var pm = context.getPackageManager();
        var pkgs = pm.getInstalledPackages(0);
        var re = new RegExp(APP_NAME_PATTERN);
        for (var i = 0; i < pkgs.size(); i++) {
            var pi = pkgs.get(i);
            var label = "";
            try { label = pi.applicationInfo.loadLabel(pm).toString(); } catch (e) { continue; }
            if (!label || !re.test(label)) continue;
            if (label.indexOf("服务") >= 0) continue;
            out.push({ name: label, pkg: pi.packageName });
        }
    } catch (e) {
        log("枚举失败: " + e);
    }
    var seen = {}, uniq = [];
    for (var j = 0; j < out.length; j++) {
        if (!seen[out[j].pkg]) { seen[out[j].pkg] = 1; uniq.push(out[j]); }
    }
    return uniq;
}

// ==================== ④ 单个 App 巡检 ====================

function autoNavigate() {
    var tabs = ["我的", "我的淘宝", "我的京东", "个人中心", "我"];
    for (var i = 0; i < tabs.length; i++) {
        if (tapTextView(tabs[i])) { sleep(1500); break; }
    }
    var entries = ["收货地址", "地址管理", "地址簿", "管理收货地址", "收货信息"];
    for (var j = 0; j < entries.length; j++) {
        if (tapTextView(entries[j])) { sleep(1800); return true; }
    }
    return false;
}

function waitForAddressPage(timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var n = 0;
    while (Date.now() < deadline) {
        if (onAddressPage()) {
            n++;
            if (n >= 2) return true;
        } else { n = 0; }
        sleep(900);
    }
    return false;
}

function trySetDefault(appName) {
    var fixed = "未执行";
    var kw = NEW_KEYWORDS[0];
    for (var i = 0; i < NEW_KEYWORDS.length; i++) {
        var w = textContains(NEW_KEYWORDS[i]).findOnce();
        if (w) {
            kw = NEW_KEYWORDS[i];
            var b = w.bounds();
            if (CONFIRM_EACH_CLICK) {
                var ok = dialogs.confirm(
                    "【" + appName + "】\n将在含「" + kw + "」的那条地址旁点击「设为默认」。\n确认执行？"
                );
                if (!ok) return "用户跳过";
            }
            if (clickSetDefaultInRow(b.centerY())) {
                sleep(1500);
                fixed = "已点设为默认";
            } else {
                fixed = "该行取不到『设为默认』按钮，未动手";
            }
            return fixed;
        }
    }
    return "页面未出现新地址关键词(" + kw + ")，无法定位";
}

function checkApp(appInfo) {
    var rec = {
        name: appInfo.name, pkg: appInfo.pkg,
        status: "未检查", newHits: [], oldHits: [],
        hasNew: false, hasOld: false, fix: "未执行", note: ""
    };

    try { app.launchPackage(appInfo.pkg); }
    catch (e) {
        rec.status = "启动失败";
        return rec;
    }

    sleep(2500);

    var nav = autoNavigate();
    var got = waitForAddressPage(nav ? WAIT_PER_APP_MS / 2 : 6000);

    if (!got) {
        toast("请手动进入【" + appInfo.name + "】→ 我的 → 收货地址");
        rec.note = "自动导航失败，转手动";
        got = waitForAddressPage(MANUAL_FALLBACK_MS);
    }

    if (!got) {
        rec.status = "超时：未进入地址页";
        return rec;
    }

    sleep(700);

    var t = joinedText();
    rec.newHits = hits(t, NEW_KEYWORDS);
    rec.oldHits = hits(t, OLD_KEYWORDS);
    rec.hasNew = rec.newHits.length > 0;
    rec.hasOld = rec.oldHits.length > 0;

    if (rec.hasOld && rec.hasNew) rec.status = "⚠ 新旧地址并存";
    else if (rec.hasOld)        rec.status = "⚠ 只有旧地址";
    else if (rec.hasNew)        rec.status = "✔ 已是新地址";
    else                        rec.status = "需人工确认";

    if (ALLOW_AUTO_SET_DEFAULT && rec.hasNew && rec.hasOld) {
        rec.fix = trySetDefault(appInfo.name);
        sleep(1500);
        var t2 = joinedText();
        if (hits(t2, OLD_KEYWORDS).length === 0) {
            rec.status = "✔ 已切换为新地址";
        }
    } else if (rec.hasNew && !rec.hasOld) {
        rec.fix = "已是新地址，无需操作";
    }

    log(appInfo.name + " => " + rec.status + " / " + rec.fix);
    toast(appInfo.name + "：" + rec.status);
    return rec;
}

// ==================== ⑤ 输出 ====================

function writeReport() {
    try { files.createWithDirs(OUT_DIR); } catch (e) { }

    var p1 = OUT_DIR + "购物App清单_" + dateStr + ".csv";
    var l1 = ['"应用名","包名"'];
    for (var i = 0; i < INSTALLED.length; i++) {
        l1.push(csvCell(INSTALLED[i].name) + "," + csvCell(INSTALLED[i].pkg));
    }
    files.write(p1, "\ufeff" + l1.join("\r\n"));

    var p2 = OUT_DIR + "地址巡检结果_" + dateStr + ".csv";
    var l2 = ['"应用名","包名","结论","命中新地址","命中旧地址","修复动作","备注"'];
    for (var j = 0; j < RESULT.length; j++) {
        var r = RESULT[j];
        l2.push([
            csvCell(r.name), csvCell(r.pkg), csvCell(r.status),
            csvCell(r.newHits.join("/")), csvCell(r.oldHits.join("/")),
            csvCell(r.fix), csvCell(r.note)
        ].join(","));
    }
    files.write(p2, "\ufeff" + l2.join("\r\n"));

    return p1 + "\n" + p2;
}

// ==================== ⑥ 主流程 ====================

auto.waitFor();

log("开始枚举购物类 App…");
INSTALLED = listShoppingApps();
log("共发现 " + INSTALLED.length + " 个疑似购物 App");
for (var i = 0; i < INSTALLED.length; i++) log("  " + INSTALLED[i].name + " -> " + INSTALLED[i].pkg);

if (INSTALLED.length === 0) {
    dialogs.alert("没有发现购物类 App", "可能是无障碍或应用列表权限未开，或关键词未覆盖你用的 App。", function () { });
    exit();
}

var go = dialogs.confirm(
    "发现 " + INSTALLED.length + " 个购物类 App\n\n" +
    "接下来会逐个打开并进入收货地址页。\n" +
    "全部只做两件事：读取地址 + （经你确认后）点『设为默认』。\n" +
    "不会删除、不会编辑地址内容。\n\n开始？"
);
if (!go) exit();

for (var k = 0; k < INSTALLED.length; k++) {
    RESULT.push(checkApp(INSTALLED[k]));
    sleep(600);
}

var paths = writeReport();

var bad = 0, ok = 0;
for (var m = 0; m < RESULT.length; m++) {
    if (RESULT[m].status.indexOf("⚠") >= 0) bad++;
    else if (RESULT[m].status.indexOf("✔") >= 0) ok++;
}

dialogs.build({
    title: "巡检完成",
    content: "共检查 " + RESULT.length + " 个 App\n正常 " + ok + " / 待处理 " + bad +
        "\n\n报告：\n" + paths,
    positive: "好",
    negative: "复制路径",
    canceledOnTouchOutside: false
}).on("negative", function () { setClip(paths); toast("已复制"); }).show();
