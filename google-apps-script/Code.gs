/**
 * ระบบแจ้งสิ่งของชำรุด — โรงเรียนดอนศาลานำวิทยา
 * Backend: Google Apps Script + Google Sheets (ฐานข้อมูล) + Google Drive (เก็บรูป) + Gmail (แจ้งเตือน)
 *
 * วิธีติดตั้ง:
 * 1. สร้าง Google Sheet ใหม่ 1 ไฟล์ (ชื่ออะไรก็ได้ เช่น "ข้อมูลแจ้งซ่อม")
 * 2. เมนู Extensions > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมด แล้ววางไฟล์นี้แทน
 * 4. แก้ไขค่าใน CONFIG ด้านล่างให้ตรงกับอีเมลของแต่ละฝ่ายจริง
 * 5. กด Deploy > New deployment > เลือกประเภท "Web app"
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 6. คัดลอก Web app URL ที่ได้ ไปใส่ใน config.js ฝั่งเว็บ (APPS_SCRIPT_URL)
 * 7. ครั้งแรกที่รัน ระบบจะสร้างชีท "Reports" และโฟลเดอร์รูปภาพใน Drive ให้อัตโนมัติ
 */

const SHEET_NAME = 'Reports';
const DRIVE_FOLDER_NAME = 'DonSala-RepairPhotos';

// ---- แก้อีเมลผู้รับผิดชอบแต่ละฝ่ายตรงนี้ ----
const DEPT_EMAILS = {
  'ฝ่ายอาคารสถานที่': 'pischayas@gmail.com',
  'ฝ่ายไฟฟ้า': 'electric@donsala.example.ac.th',
  'ฝ่ายคอมพิวเตอร์/IT': 'it@donsala.example.ac.th',
  'ฝ่ายสุขาภิบาล/ประปา': 'plumbing@donsala.example.ac.th',
  'ฝ่ายพัสดุ/ครุภัณฑ์': 'asset@donsala.example.ac.th'
};

const HEADERS = ['ID','Timestamp','Name','Location','LocDetail','Category','Detail','Urgency','Dept','PhotoURL','Status','StatusUpdated'];
// ชื่อคีย์ที่ใช้ฝั่งหน้าเว็บ (JS) ตรงกับ HEADERS ทีละตำแหน่ง — กำหนดตรงๆ แทนการเดาตัวพิมพ์เล็ก/ใหญ่ เพื่อกัน id พัง
const KEYS = ['id','timestamp','name','location','locDetail','category','detail','urgency','dept','photoURL','status','statusUpdated'];

// ================= Entry points =================

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'list') {
    return jsonResponse({ success: true, reports: getAllReports() });
  }
  return jsonResponse({ success: false, error: 'unknown action' });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    if (action === 'create') return createReport(data);
    if (action === 'updateStatus') return updateStatus(data);
    return jsonResponse({ success: false, error: 'unknown action' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ================= Core logic =================

function createReport(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet();
    const id = 'RP' + new Date().getTime().toString(36).toUpperCase();
    const timestamp = new Date();

    let photoUrl = '';
    let photoBlob = null;
    if (data.photoBase64) {
      photoBlob = decodePhotoBlob(data.photoBase64, id);
      if (photoBlob) photoUrl = uploadBlobToDrive(photoBlob);
    }

    sheet.appendRow([
      id, timestamp, data.name || '', data.location || '', data.locdetail || '',
      data.category || '', data.detail || '', data.urgency || '', data.dept || '',
      photoUrl, 'รอดำเนินการ', timestamp
    ]);

    notifyDepartment(data, id, photoUrl, photoBlob);

    return jsonResponse({ success: true, id: id });
  } finally {
    lock.releaseLock();
  }
}

function updateStatus(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet();
    const values = sheet.getDataRange().getValues();
    const idCol = HEADERS.indexOf('ID');
    const statusCol = HEADERS.indexOf('Status');
    const statusUpdatedCol = HEADERS.indexOf('StatusUpdated');

    for (let i = 1; i < values.length; i++) {
      if (values[i][idCol] === data.id) {
        sheet.getRange(i + 1, statusCol + 1).setValue(data.status);
        sheet.getRange(i + 1, statusUpdatedCol + 1).setValue(new Date());
        return jsonResponse({ success: true });
      }
    }
    return jsonResponse({ success: false, error: 'ไม่พบรายการ ID นี้' });
  } finally {
    lock.releaseLock();
  }
}

function getAllReports() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const reports = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0]) continue;
    const obj = {};
    KEYS.forEach((key, idx) => {
      let v = row[idx];
      if (v instanceof Date) v = v.toISOString();
      obj[key] = v;
    });
    reports.push(obj);
  }
  reports.reverse(); // ใหม่สุดขึ้นก่อน
  return reports;
}

// ================= Helpers =================

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPhotoFolder() {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function decodePhotoBlob(base64Data, id) {
  const matches = base64Data.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!matches) return null;
  const mimeType = matches[1];
  const base64 = matches[2];
  const ext = mimeType.split('/')[1] || 'jpg';
  return Utilities.newBlob(Utilities.base64Decode(base64), mimeType, id + '.' + ext);
}

function uploadBlobToDrive(blob) {
  const folder = getPhotoFolder();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
}

function notifyDepartment(data, id, photoUrl, photoBlob) {
  const email = DEPT_EMAILS[data.dept];
  if (!email) return;
  const subject = '[แจ้งซ่อม ' + id + '] ' + data.location + (data.locdetail ? ' · ' + data.locdetail : '');

  // เนื้อความแบบข้อความล้วน (สำรองไว้สำหรับโปรแกรมอีเมลที่ไม่รองรับ HTML)
  let plainBody = 'มีรายการแจ้งของชำรุดใหม่\n\n' +
    'รหัส: ' + id + '\n' +
    'ผู้แจ้ง: ' + data.name + '\n' +
    'สถานที่: ' + data.location + (data.locdetail ? ' (' + data.locdetail + ')' : '') + '\n' +
    'หมวดหมู่: ' + data.category + '\n' +
    'รายละเอียด: ' + data.detail + '\n' +
    'ความเร่งด่วน: ' + data.urgency + '\n';
  if (photoUrl) plainBody += '\nรูปภาพ: ' + photoUrl + '\n';

  const options = { htmlBody: buildEmailHtml(data, id, photoUrl, !!photoBlob) };
  if (photoBlob) {
    // ฝังรูปในเนื้ออีเมลโดยตรงด้วย cid แทนการใส่แค่ลิงก์ ทำให้เห็นรูปทันทีโดยไม่ต้องคลิก
    options.inlineImages = { reportPhoto: photoBlob };
  }

  try {
    MailApp.sendEmail(email, subject, plainBody, options);
  } catch (e) {
    // ถ้าส่งเมลไม่สำเร็จ ไม่ต้องให้ทั้งฟังก์ชันล้มเหลว แค่ข้าม
  }
}

function buildEmailHtml(data, id, photoUrl, hasInlinePhoto) {
  const urgencyColor = data.urgency === 'สูง' ? '#E0483C' : (data.urgency === 'กลาง' ? '#B8860B' : '#2E9E63');
  const photoHtml = hasInlinePhoto
    ? '<img src="cid:reportPhoto" style="max-width:100%;border-radius:10px;margin:16px 0;display:block;border:1px solid #eee;">'
    : (photoUrl ? '<p style="margin:14px 0;"><a href="' + photoUrl + '" style="color:#B8860B;">ดูรูปภาพประกอบ</a></p>' : '');

  return '' +
    '<div style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;">' +
      '<div style="background:#2A2A2E;padding:22px 20px;border-radius:14px 14px 0 0;">' +
        '<span style="color:#F2B705;font-weight:bold;font-size:12px;letter-spacing:0.04em;">แจ้งซ่อม · ' + id + '</span><br>' +
        '<span style="color:#fff;font-size:19px;font-weight:bold;">' + data.location + (data.locdetail ? ' · ' + data.locdetail : '') + '</span>' +
      '</div>' +
      '<div style="background:#ffffff;border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 14px 14px;">' +
        photoHtml +
        '<table style="width:100%;border-collapse:collapse;font-size:14px;color:#2A2A2E;">' +
          '<tr><td style="padding:5px 0;color:#6B6B72;width:110px;">ผู้แจ้ง</td><td style="padding:5px 0;">' + data.name + '</td></tr>' +
          '<tr><td style="padding:5px 0;color:#6B6B72;">หมวดหมู่</td><td style="padding:5px 0;">' + data.category + '</td></tr>' +
          '<tr><td style="padding:5px 0;color:#6B6B72;">รายละเอียด</td><td style="padding:5px 0;">' + data.detail + '</td></tr>' +
          '<tr><td style="padding:5px 0;color:#6B6B72;">ความเร่งด่วน</td><td style="padding:5px 0;"><span style="color:' + urgencyColor + ';font-weight:bold;">' + data.urgency + '</span></td></tr>' +
        '</table>' +
      '</div>' +
    '</div>';
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
