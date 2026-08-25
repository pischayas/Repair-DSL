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
  'ฝ่ายอาคารสถานที่': 'building@donsala.example.ac.th',
  'ฝ่ายไฟฟ้า': 'electric@donsala.example.ac.th',
  'ฝ่ายคอมพิวเตอร์/IT': 'it@donsala.example.ac.th',
  'ฝ่ายสุขาภิบาล/ประปา': 'plumbing@donsala.example.ac.th',
  'ฝ่ายพัสดุ/ครุภัณฑ์': 'asset@donsala.example.ac.th'
};

const HEADERS = ['ID','Timestamp','Name','Location','LocDetail','Category','Detail','Urgency','Dept','PhotoURL','Status','StatusUpdated'];

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
    if (data.photoBase64) {
      photoUrl = savePhotoToDrive(data.photoBase64, id);
    }

    sheet.appendRow([
      id, timestamp, data.name || '', data.location || '', data.locdetail || '',
      data.category || '', data.detail || '', data.urgency || '', data.dept || '',
      photoUrl, 'รอดำเนินการ', timestamp
    ]);

    notifyDepartment(data, id, photoUrl);

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
    HEADERS.forEach((h, idx) => {
      let v = row[idx];
      if (v instanceof Date) v = v.toISOString();
      obj[h.charAt(0).toLowerCase() + h.slice(1)] = v;
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

function savePhotoToDrive(base64Data, id) {
  const matches = base64Data.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!matches) return '';
  const mimeType = matches[1];
  const base64 = matches[2];
  const ext = mimeType.split('/')[1] || 'jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, id + '.' + ext);
  const folder = getPhotoFolder();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?id=' + file.getId();
}

function notifyDepartment(data, id, photoUrl) {
  const email = DEPT_EMAILS[data.dept];
  if (!email) return;
  const subject = '[แจ้งซ่อม ' + id + '] ' + data.location + (data.locdetail ? ' · ' + data.locdetail : '');
  let body = 'มีรายการแจ้งของชำรุดใหม่\n\n' +
    'รหัส: ' + id + '\n' +
    'ผู้แจ้ง: ' + data.name + '\n' +
    'สถานที่: ' + data.location + (data.locdetail ? ' (' + data.locdetail + ')' : '') + '\n' +
    'หมวดหมู่: ' + data.category + '\n' +
    'รายละเอียด: ' + data.detail + '\n' +
    'ความเร่งด่วน: ' + data.urgency + '\n';
  if (photoUrl) body += '\nรูปภาพ: ' + photoUrl + '\n';
  try {
    MailApp.sendEmail(email, subject, body);
  } catch (e) {
    // ถ้าส่งเมลไม่สำเร็จ ไม่ต้องให้ทั้งฟังก์ชันล้มเหลว แค่ข้าม
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
