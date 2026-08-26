// ===================================================================
// แก้ไขตัวเลือกในแต่ละหัวข้อได้ตรงนี้ — เพิ่ม/ลบ/เปลี่ยนชื่อได้อิสระ
// เพียงพิมพ์ข้อความในเครื่องหมาย " " คั่นด้วยจุลภาค , แล้วบันทึกไฟล์
// ===================================================================

// ตัวเลือก "สถานที่ตั้ง"
const LOCATIONS = ["ห้องเรียน","ห้องปฏิบัติการวิทยาศาสตร์","ห้องคอมพิวเตอร์","ห้องสมุด","ห้องพักครู","โรงอาหาร","สนามกีฬา/สนามเด็กเล่น","ห้องน้ำ","อาคารเรียน/ทางเดิน","ห้องประชุม","อื่นๆ"];

// ตัวเลือก "หมวดหมู่สิ่งของ"
const CATEGORIES = ["โต๊ะ/เก้าอี้","ไฟฟ้า/หลอดไฟ","ประตู/หน้าต่าง","เครื่องปรับอากาศ/พัดลม","คอมพิวเตอร์/อุปกรณ์IT","ประปา/สุขภัณฑ์","อุปกรณ์กีฬา","อื่นๆ"];

// ตัวเลือก "แจ้งไปยังฝ่าย" — ⚠️ ถ้าแก้ชื่อฝ่ายตรงนี้ ต้องไปแก้ชื่อให้ตรงกันเป๊ะๆ
// ใน DEPT_EMAILS ที่ไฟล์ google-apps-script/Code.gs ด้วย ไม่งั้นระบบจะหาอีเมลไม่เจอ
const DEPARTMENTS = ["ฝ่ายอาคารสถานที่","ฝ่ายไฟฟ้า","ฝ่ายคอมพิวเตอร์/IT","ฝ่ายสุขาภิบาล/ประปา","ฝ่ายพัสดุ/ครุภัณฑ์"];

// สถานะงาน — ถ้าจะแก้ ให้แก้ทั้ง 3 จุด: ตรงนี้, คลาส CSS .stamp.<ชื่อสถานะ> ในไฟล์ style.css,
// และ Code.gs ที่ตั้งค่า Status เริ่มต้นเป็น 'รอดำเนินการ' ตอนสร้างรายการใหม่
const STATUSES = ["รอดำเนินการ","กำลังดำเนินการ","เสร็จสิ้น"];

let currentPhotoData = null;
let adminFilter = "ทั้งหมด";

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2400);
}

const TAG_COLORS = ['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)','var(--c7)','var(--c8)'];
function colorForString(str){
  let hash = 0;
  for(let i=0;i<str.length;i++){ hash = str.charCodeAt(i) + ((hash<<5)-hash); }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}
function tag(label){
  return `<span class="tag" style="background:${colorForString(label)}"><span class="dot"></span>${label}</span>`;
}

function genOptions(arr, placeholder){
  return `<option value="">${placeholder}</option>` + arr.map(o=>`<option value="${o}">${o}</option>`).join('');
}

function checkConfig(){
  if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') !== -1){
    document.querySelector('.wrap').insertAdjacentHTML('afterbegin',
      `<div style="background:#F5DFD5;border:1.5px solid var(--rust);color:var(--rust);padding:12px 14px;border-radius:6px;font-size:13px;margin-bottom:16px;">
        ⚠️ ยังไม่ได้ตั้งค่า APPS_SCRIPT_URL ใน config.js — โปรด deploy Google Apps Script แล้วนำ URL มาใส่ก่อนใช้งาน
      </div>`);
    return false;
  }
  return true;
}

// ---------- API helpers ----------
async function apiCreate(payload){
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
    body: JSON.stringify(Object.assign({ action: 'create' }, payload))
  });
  return res.json();
}

async function apiUpdateStatus(id, status){
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'updateStatus', id, status })
  });
  return res.json();
}

async function apiList(){
  const res = await fetch(APPS_SCRIPT_URL + '?action=list');
  const data = await res.json();
  return data.success ? data.reports : [];
}

// ---------- Report form view ----------
function renderReportView(){
  const el = document.getElementById('view-report');
  el.innerHTML = `
    <div class="ticket">
      <div class="ticket-head">
        <span class="tno">FORM · แจ้งของชำรุด</span>
        <span class="tno">${new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})}</span>
      </div>
      <div class="ticket-body">
        <label>ชื่อผู้แจ้ง</label>
        <input type="text" id="f-name" placeholder="เช่น ครูสมชาย / นักเรียนชั้น ม.3/1">

        <div class="row2">
          <div>
            <label>สถานที่ตั้ง</label>
            <select id="f-location">${genOptions(LOCATIONS,"เลือกสถานที่")}</select>
          </div>
          <div>
            <label>ระบุห้อง/จุดที่ตั้ง</label>
            <input type="text" id="f-locdetail" placeholder="เช่น ม.2/3, ชั้น 2">
          </div>
        </div>

        <label>หมวดหมู่สิ่งของ</label>
        <select id="f-category">${genOptions(CATEGORIES,"เลือกหมวดหมู่")}</select>

        <label>รายละเอียดความชำรุด</label>
        <textarea id="f-detail" placeholder="อธิบายลักษณะความเสียหาย เช่น เก้าอี้ขาหัก 2 ตัว"></textarea>

        <label>ความเร่งด่วน</label>
        <div class="urgency-group">
          <input type="radio" name="lv" id="lv-ต่ำ" value="ต่ำ">
          <label class="opt" for="lv-ต่ำ">ทั่วไป</label>
          <input type="radio" name="lv" id="lv-กลาง" value="กลาง" checked>
          <label class="opt" for="lv-กลาง">ปานกลาง</label>
          <input type="radio" name="lv" id="lv-สูง" value="สูง">
          <label class="opt" for="lv-สูง">เร่งด่วน</label>
        </div>

        <label>แจ้งไปยังฝ่าย</label>
        <select id="f-dept">${genOptions(DEPARTMENTS,"เลือกฝ่ายที่รับผิดชอบ")}</select>

        <label>รูปภาพสิ่งของที่ชำรุด <span class="req">*</span></label>
        <div class="photo-drop" id="photoDrop">
          <span class="drop-icon">📷</span>
          <span class="drop-title">แตะเพื่อถ่ายรูปหรือเลือกรูปภาพ</span>
          <span class="drop-sub">จำเป็นต้องแนบรูปทุกครั้ง เพื่อให้ผู้รับผิดชอบเห็นสภาพจริง</span>
          <input type="file" id="f-photo" accept="image/*" capture="environment">
        </div>

        <button class="submit-btn" id="submitBtn">📌 ส่งแจ้งซ่อม</button>
      </div>
    </div>
  `;

  document.getElementById('photoDrop').onclick = ()=>document.getElementById('f-photo').click();
  document.getElementById('f-photo').onchange = handlePhotoSelect;
  document.getElementById('submitBtn').onclick = submitReport;
}

function handlePhotoSelect(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    const img = new Image();
    img.onload = ()=>{
      const maxW = 700;
      const scale = Math.min(1, maxW/img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width*scale;
      canvas.height = img.height*scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      currentPhotoData = canvas.toDataURL('image/jpeg', 0.6);
      const drop = document.getElementById('photoDrop');
      drop.classList.add('filled');
      drop.classList.remove('error');
      drop.innerHTML = `<img src="${currentPhotoData}"><button type="button" class="photo-remove" id="photoRemove">✕</button><input type="file" id="f-photo" accept="image/*" capture="environment">`;
      document.getElementById('f-photo').onchange = handlePhotoSelect;
      drop.onclick = ()=>document.getElementById('f-photo').click();
      document.getElementById('photoRemove').onclick = (ev)=>{
        ev.stopPropagation();
        currentPhotoData = null;
        drop.classList.remove('filled');
        drop.innerHTML = `<span class="drop-icon">📷</span><span class="drop-title">แตะเพื่อถ่ายรูปหรือเลือกรูปภาพ</span><span class="drop-sub">จำเป็นต้องแนบรูปทุกครั้ง เพื่อให้ผู้รับผิดชอบเห็นสภาพจริง</span><input type="file" id="f-photo" accept="image/*" capture="environment">`;
        document.getElementById('f-photo').onchange = handlePhotoSelect;
      };
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function renderSuccessView(id){
  const el = document.getElementById('view-report');
  el.innerHTML = `
    <div class="success-card">
      <div class="success-circle">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5L20 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h2>ส่งแจ้งซ่อมเรียบร้อย!</h2>
      <p class="sub">ระบบได้ส่งอีเมลแจ้งฝ่ายที่รับผิดชอบให้แล้ว</p>
      <div class="rid">${id}</div>
      <div class="success-actions">
        <button class="btn-again" id="btnAgain">📋 แจ้งอีกรายการ</button>
        <button class="btn-track" id="btnTrack">🛠️ ดูสถานะ</button>
      </div>
    </div>
  `;
  document.getElementById('btnAgain').onclick = renderReportView;
  document.getElementById('btnTrack').onclick = ()=>document.getElementById('tab-admin').click();
}

async function submitReport(){
  if(!checkConfig()) return;

  const name = document.getElementById('f-name').value.trim();
  const location = document.getElementById('f-location').value;
  const locdetail = document.getElementById('f-locdetail').value.trim();
  const category = document.getElementById('f-category').value;
  const detail = document.getElementById('f-detail').value.trim();
  const urgency = document.querySelector('input[name=lv]:checked').value;
  const dept = document.getElementById('f-dept').value;

  if(!name || !location || !category || !detail || !dept){
    toast('กรุณากรอกข้อมูลให้ครบก่อนส่ง');
    return;
  }

  if(!currentPhotoData){
    toast('กรุณาแนบรูปภาพสิ่งของที่ชำรุดก่อนส่ง');
    const drop = document.getElementById('photoDrop');
    drop.classList.add('error');
    drop.scrollIntoView({ behavior:'smooth', block:'center' });
    setTimeout(()=>drop.classList.remove('error'), 500);
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังส่ง...';

  try{
    const result = await apiCreate({
      name, location, locdetail, category, detail, urgency, dept,
      photoBase64: currentPhotoData
    });
    if(result.success){
      renderSuccessView(result.id);
      currentPhotoData = null;
      refreshPendingDot();
    } else {
      toast('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่ทราบสาเหตุ'));
      btn.disabled = false;
      btn.textContent = '📌 ส่งแจ้งซ่อม';
    }
  }catch(err){
    console.error(err);
    toast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบ APPS_SCRIPT_URL');
    btn.disabled = false;
    btn.textContent = '📌 ส่งแจ้งซ่อม';
  }
}

// ---------- Admin view ----------
async function refreshPendingDot(){
  if(!checkConfig()) return;
  const reports = await apiList();
  const pending = reports.filter(r=>r.status==='รอดำเนินการ').length;
  const dot = document.getElementById('pendingDot');
  if(pending>0){ dot.style.display='inline-block'; dot.textContent = pending; }
  else{ dot.style.display='none'; }
}

async function renderAdminView(){
  if(!checkConfig()) return;
  const el = document.getElementById('view-admin');
  el.innerHTML = `<div class="empty">กำลังโหลดรายการ...</div>`;
  const reports = await apiList();

  const counts = {
    'รอดำเนินการ': reports.filter(r=>r.status==='รอดำเนินการ').length,
    'กำลังดำเนินการ': reports.filter(r=>r.status==='กำลังดำเนินการ').length,
    'เสร็จสิ้น': reports.filter(r=>r.status==='เสร็จสิ้น').length,
  };

  const filtered = adminFilter==='ทั้งหมด' ? reports : reports.filter(r=>r.status===adminFilter);

  el.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="stat-icon" style="background:#FBDCD5">⏳</div><div class="n" style="color:var(--rust)">${counts['รอดำเนินการ']}</div><div class="l">รอดำเนินการ</div></div>
      <div class="stat"><div class="stat-icon" style="background:#FCEBB8">🛠️</div><div class="n" style="color:var(--amber-deep)">${counts['กำลังดำเนินการ']}</div><div class="l">กำลังดำเนินการ</div></div>
      <div class="stat"><div class="stat-icon" style="background:#D3EEDF">✅</div><div class="n" style="color:var(--green)">${counts['เสร็จสิ้น']}</div><div class="l">เสร็จสิ้น</div></div>
    </div>
    <div class="filters" id="filterBar">
      ${['ทั้งหมด',...STATUSES].map(s=>`<button data-f="${s}" class="${s===adminFilter?'active':''}">${s}</button>`).join('')}
    </div>
    <div id="ticketList"></div>
  `;

  document.getElementById('filterBar').querySelectorAll('button').forEach(b=>{
    b.onclick = ()=>{ adminFilter = b.dataset.f; renderAdminView(); };
  });

  const listEl = document.getElementById('ticketList');
  if(filtered.length===0){
    listEl.innerHTML = `<div class="empty"><span class="e-icon">🗂️</span>ไม่มีรายการแจ้งซ่อมในหมวดนี้</div>`;
    return;
  }
  listEl.innerHTML = filtered.map((r,i)=>`
    <div class="ticket list-item" data-id="${r.id}" style="animation-delay:${Math.min(i*0.05,0.4)}s">
      <div class="ticket-head">
        <span class="tno">${r.id} · ${r.dept}</span>
        <span class="stamp ${r.status}">${r.status}</span>
      </div>
      <div class="ticket-body">
        ${r.photoURL ? `<img class="thumb" src="${r.photoURL}">` : `<div class="thumb-empty">ไม่มีรูป</div>`}
        <div class="li-info">
          <div class="loc">${r.location}${r.locDetail ? ' · '+r.locDetail : ''}</div>
          <div class="det">${r.detail}</div>
          <div class="tag-row">${tag(r.category)}${tag(r.dept)}</div>
          <div class="li-meta">โดย ${r.name} · ${new Date(r.timestamp).toLocaleString('th-TH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
        </div>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.list-item').forEach(item=>{
    item.onclick = ()=>openDetail(reports.find(r=>r.id===item.dataset.id));
  });

  refreshPendingDot();
}

function openDetail(r){
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal">
      <div class="modal-handle"></div>
      <button class="modal-close" id="closeModal">✕</button>
      <div class="tno">${r.id}</div>
      <h2 style="font-family:'Prompt',sans-serif;margin:8px 0;">${r.location}${r.locDetail ? ' · '+r.locDetail : ''}</h2>
      ${r.photoURL ? `<img src="${r.photoURL}">` : ''}
      <div class="tag-row">${tag(r.category)}${tag(r.dept)}${tag(r.urgency)}</div>
      <p><b>รายละเอียด:</b> ${r.detail}</p>
      <p><b>ผู้แจ้ง:</b> ${r.name} &nbsp;·&nbsp; ${new Date(r.timestamp).toLocaleString('th-TH')}</p>
      <label style="margin-top:10px;">อัปเดตสถานะ</label>
      <div class="status-btns" id="statusBtns">
        ${STATUSES.map(s=>`<button data-s="${s}" class="${s===r.status?'current':''}">${s}</button>`).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  bg.onclick = (e)=>{ if(e.target===bg) bg.remove(); };
  document.getElementById('closeModal').onclick = ()=>bg.remove();
  bg.querySelectorAll('#statusBtns button').forEach(b=>{
    b.onclick = async ()=>{
      const newStatus = b.dataset.s;
      try{
        const result = await apiUpdateStatus(r.id, newStatus);
        if(result.success){
          toast('อัปเดตสถานะเป็น "'+newStatus+'"');
          bg.remove();
          renderAdminView();
        } else {
          toast('อัปเดตไม่สำเร็จ: ' + (result.error||''));
        }
      }catch(e){ toast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); }
    };
  });
}

// ---------- Tabs ----------
document.getElementById('tab-report').onclick = ()=>{
  document.getElementById('tab-report').classList.add('active');
  document.getElementById('tab-admin').classList.remove('active');
  document.getElementById('view-report').style.display='block';
  document.getElementById('view-admin').style.display='none';
};
document.getElementById('tab-admin').onclick = ()=>{
  document.getElementById('tab-admin').classList.add('active');
  document.getElementById('tab-report').classList.remove('active');
  document.getElementById('view-admin').style.display='block';
  document.getElementById('view-report').style.display='none';
  renderAdminView();
};

checkConfig();
renderReportView();
refreshPendingDot();
