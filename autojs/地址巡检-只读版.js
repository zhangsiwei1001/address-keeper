/**
 * 收货地址巡检脚本（只读版）(AutoX.js / AutoJS Pro)
 * -------------------------------------------------
 * 逐个打开购物 App，你手动进入「我的 → 收货地址」，脚本读屏判断地址新旧。
 *
 * 特点：只读屏幕，不点击、不输入、不下单 —— 全程零交易风险。
 * 需要权限：无障碍服务（读屏必需）
 * 使用说明：docs/只读版使用说明.md
 */

// ============ ① 必须改的配置 ============

var NEW_KEYWORDS = [
    "新城区",
    "新城路",
    "示例小区"
];

var OLD_KEYWORDS = [
    "老城区",
    "老城路"
];

var MY_PHONE = "";

// ============ ② 要巡检的 App ============

var APPS = [
    { name: "淘宝",       pkg: "com.taobao.taobao",          enable: true },
    { name: "天猫",       pkg: "com.tmall.wireless",         enable: true },
    { name: "京东",       pkg: "com.jingdong.app.mall",      enable: true },
    { name: "拼多多",     pkg: "com.xunmeng.pinduoduo",      enable: true },
    { name: "抖音商城",   pkg: "com.ss.android.ugc.aweme",   enable: true },
    { name: "快手小店",   pkg: "com.smile.gifmaker",         enable: true },
    { name: "唯品会",     pkg: "com.achievo.vipshop",        enable: true },
    { name: "小红书",     pkg: "com.xingin.xhs",             enable: true },
    { name: "得物",       pkg: "com.shizhuang.duapp",        enable: true },
    { name: "苏宁易购",   pkg: "com.suning.mobile.ebuy",     enable: true },
    { name: "美团",       pkg: "com.sankuai.meituan",        enable: true },
    { name: "饿了么",     pkg: "me.ele",                     enable: true }
];

var PAGE_HINTS = ["收货地址", "地址管理", "新增地址", "管理收货地址", "默认地址", "地址簿"];

var WAIT_PER_APP_MS = 180000;
var SAVE_RAW_TEXT = true;

// ============ ③ 以下是逻辑，一般不用改 ============

var OUT_DIR = "/sdcard/地址巡检/";
var RESULT = [];
var dateStr = new java.text.SimpleDateFormat("yyyyMMdd_HHmm").format(new java.util.Date());

function log(msg) { console.log(msg); }

function collectTexts() {
    var texts = [];
    try {
        var vs = className("android.widget.TextView").find();
        for (var i = 0; i < vs.size(); i++) {
            var t = vs.get(i).text();
            if (t && t.length > 0) texts.push(t);
        }
        var es = className("android.widget.EditText").find();
        for (var j = 0; j < es.size(); j++) {
            var t2 = es.get(j).text();
            if (t2 && t2.length > 0) texts.push(t2);
        }
    } catch (e) {
        log("collectTexts 异常: " + e);
    }
    return texts;
}

function joined(texts) { return texts.join(" | "); }

function hitKeywords(text, kws) {
    var hits = [];
    for (var i = 0; i < kws.length; i++) {
        if (kws[i] && text.indexOf(kws[i]) >= 0) hits.push(kws[i]);
    }
    return hits;
}

function isAddressPage(texts) {
    var t = joined(texts);
    var hint = hitKeywords(t, PAGE_HINTS);
    if (hint.length === 0) return false;
    return /1[3-9]\d{9}/.test(t) || t.indexOf("收件人") >= 0 ||
        t.indexOf("省") >= 0 || t.indexOf("区") >= 0 || t.indexOf("默认") >= 0;
}

function pickAddressLines(texts) {
    var out = [];
    for (var i = 0; i < texts.length; i++) {
        var s = texts[i];
        if (!s) continue;
        if (s.length < 6) continue;
        var isAddr = /1[3-9]\d{9}/.test(s) ||
            s.indexOf("收件人") >= 0 ||
            (s.indexOf("省") >= 0 && s.indexOf("市") >= 0) ||
            s.indexOf("详细地址") >= 0;
        if (isAddr) {
            if (MY_PHONE && s.indexOf(MY_PHONE) < 0 && !/1[3-9]\d{9}/.test(s)) continue;
            out.push(s);
        }
    }
    return out;
}

function maskPhone(s) {
    return s.replace(/1[3-9]\d{9}/g, function (m) {
        return m.substring(0, 3) + "****" + m.substring(7);
    });
}

function csvCell(s) {
    if (s === null || s === undefined) return "";
    return '"' + String(s).replace(/"/g, '""') + '"';
}

function checkApp(appCfg) {
    var rec = {
        name: appCfg.name, pkg: appCfg.pkg,
        status: "未检查", newHits: [], oldHits: [], addrLines: [], raw: ""
    };

    try { app.launchPackage(appCfg.pkg); }
    catch (e) {
        try { app.launch(appCfg.pkg); } catch (e2) {
            rec.status = "启动失败(可能未安装)";
            log("启动失败 " + appCfg.name + " : " + e2);
            return rec;
        }
    }

    sleep(2500);
    toast("请打开「" + appCfg.name + "」→ 我的 → 收货地址（不动手也行，脚本会等）");

    var deadline = Date.now() + WAIT_PER_APP_MS;
    var detected = 0;
    var texts = [];

    while (Date.now() < deadline) {
        texts = collectTexts();
        if (isAddressPage(texts)) {
            detected++;
            if (detected >= 2) break;
        } else { detected = 0; }
        sleep(900);
    }

    if (detected < 2) {
        rec.status = "超时未进入地址页";
        log(appCfg.name + " 超时");
        return rec;
    }

    sleep(600);
    texts = collectTexts();
    var all = joined(texts);
    rec.raw = SAVE_RAW_TEXT ? all : "";
    rec.addrLines = pickAddressLines(texts);
    rec.newHits = hitKeywords(all, NEW_KEYWORDS);
    rec.oldHits = hitKeywords(all, OLD_KEYWORDS);

    if (rec.oldHits.length > 0) rec.status = "⚠ 存在旧地址";
    else if (rec.newHits.length > 0) rec.status = "✔ 已是新地址";
    else if (rec.addrLines.length === 0) rec.status = "未读到地址";
    else rec.status = "需人工确认";

    log(appCfg.name + " => " + rec.status);
    toast(appCfg.name + "：" + rec.status);
    return rec;
}

function writeCsv() {
    try { files.createWithDirs(OUT_DIR); } catch (e) { }

    var path = OUT_DIR + "地址巡检_" + dateStr + ".csv";
    var lines = [];
    var head = ["应用", "包名", "结论", "命中新地址片段", "命中旧地址片段", "读到的地址条数", "地址内容(手机号已脱敏)"];
    if (SAVE_RAW_TEXT) head.push("页面原始文本");
    lines.push(head.map(csvCell).join(","));

    for (var i = 0; i < RESULT.length; i++) {
        var r = RESULT[i];
        var row = [
            r.name, r.pkg, r.status,
            r.newHits.join("/"), r.oldHits.join("/"),
            r.addrLines.length,
            maskPhone(r.addrLines.join("  ||  "))
        ];
        if (SAVE_RAW_TEXT) row.push(maskPhone(r.raw));
        lines.push(row.map(csvCell).join(","));
    }

    files.write(path, "\ufeff" + lines.join("\r\n"));
    log("报告已写入: " + path);
    return path;
}

function summary() {
    var ok = 0, bad = 0, unknown = 0;
    for (var i = 0; i < RESULT.length; i++) {
        var s = RESULT[i].status;
        if (s.indexOf("✔") >= 0) ok++;
        else if (s.indexOf("⚠") >= 0) bad++;
        else unknown++;
    }
    return "已更新 " + ok + " / 有旧地址 " + bad + " / 待确认 " + unknown;
}

// ============ 主流程 ============

auto.waitFor();
log("脚本启动，开始巡检 " + APPS.length + " 个 App");

try {
    var pm = context.getPackageManager();
    var list = pm.getInstalledPackages(0);
    var found = [];
    for (var i = 0; i < list.size(); i++) {
        var pi = list.get(i);
        var label = pi.applicationInfo.loadLabel(pm).toString();
        if (/淘宝|天猫|京东|拼多多|抖音|快手|唯品|小红|得物|苏宁|美团|饿了|1688|商城|购物|严选/.test(label)) {
            found.push(label + " = " + pi.packageName);
        }
    }
    log("—— 本机疑似购物 App ——");
    for (var k = 0; k < found.length; k++) log("  " + found[k]);
} catch (e) {
    log("枚举已安装应用失败: " + e);
}

for (var i = 0; i < APPS.length; i++) {
    if (!APPS[i].enable) continue;
    var rec = checkApp(APPS[i]);
    RESULT.push(rec);
    sleep(500);
}

var path = writeCsv();
var s = summary();

dialogs.build({
    title: "地址巡检完成",
    content: s + "\n\n报告路径：\n" + path + "\n\n提示：标⚠的 App 请进去把旧地址删掉",
    positive: "好",
    negative: "复制路径",
    canceledOnTouchOutside: false
}).on("negative", function () {
    setClip(path);
    toast("路径已复制");
}).show();

log("全部完成：" + s);
