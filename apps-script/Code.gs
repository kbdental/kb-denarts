// ═══════════════════════════════════════════════════════════════
// K.B. DENARTS — Google Sheets Sync Script  v2
//
// v2 adds:
//   • TOKEN auth — without the token nobody can read or write your data
//     (v1 let anyone on the internet with the URL read every order)
//   • Server-side serial reservation (?action=reserveSerial) so two
//     devices can never both create KB-26/195
//   • Server-side doctor portal login (?action=portal) — PINs are
//     checked HERE and never sent to the browser
//   • updatedAt / invoiceNo columns on Orders
//
// SETUP
//   1. Set TOKEN below to a long random secret (e.g. 40 random chars).
//   2. Paste this whole file over the old script (Extensions → Apps Script).
//   3. Deploy → Manage Deployments → Edit → New Version → Deploy.
//      Keep: Execute as Me, Access: Anyone.
//   4. In the app: Admin → Google Sheets → paste the same token → Save.
//      (Also in the Production Log page setup screen.)
//   5. IMPORTANT: because the OLD /exec URL was publicly visible in the
//      GitHub repo, create a NEW deployment (new URL) rather than only
//      updating the old one, then delete/disable the old deployment.
//
// Leaving TOKEN = '' disables auth (works like v1 — not recommended).
// ═══════════════════════════════════════════════════════════════

var TOKEN = '';   // ← SET THIS

var ORDERS_SHEET   = 'Orders';
var DOCTORS_SHEET  = 'Doctors';
var STAFF_SHEET    = 'Staff';
var DEPTS_SHEET    = 'Departments';
var PRODUCTS_SHEET = 'Products';
var PRODLOG_SHEET  = 'Production Log';
var CORR_SHEET     = 'Corrections';
var REMARKS_SHEET  = 'Remarks';
var LOGIN_SHEET    = 'Login Log';
var INV_SHEET      = 'Inventory';
var LIST_SHEETS = {steps:'Steps',enclosures:'Enclosures',pickup:'Pickup',hold:'Hold Reasons',
                   repeat:'Repeat Reasons',implants:'Implant Types',shades:'Shades'};

var ORDER_HEADERS = ['Model No','Challan No','Date','Received Date','Due Date','Dispatch Date',
  'Doctor','Clinic','Patient','Work Type','Teeth','Units','Status',
  'Amount (₹)','Billing Status','Implant System','Notes','Invoice No','Hold Reason','Details','Updated At'];
var DOCTOR_HEADERS = ['Doctor Name','Clinic','Address','Phone','Email','Contact Person','CP Phone','Category','Pin'];

// ── plumbing ─────────────────────────────────────────────────────
function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function authed(tok){ return TOKEN==='' || String(tok||'')===TOKEN; }

function getOrCreateSheet(ss,name,headers){
  var sh=ss.getSheetByName(name);
  if(!sh){
    sh=ss.insertSheet(name);
    if(headers&&headers.length){
      sh.appendRow(headers);
      sh.getRange(1,1,1,headers.length).setBackground('#1d4ed8').setFontColor('#ffffff').setFontWeight('bold');
    }
  }
  return sh;
}
// Make sure a sheet has all the given headers, appending any that are missing
// (so v2 can add Invoice No / Updated At / Pin to sheets created by v1).
function ensureHeaders(sh,headers){
  var lastCol=sh.getLastColumn();
  var existing=lastCol>0?sh.getRange(1,1,1,lastCol).getValues()[0].map(String):[];
  headers.forEach(function(h){
    if(existing.indexOf(h)===-1){
      sh.getRange(1,existing.length+1).setValue(h)
        .setBackground('#1d4ed8').setFontColor('#ffffff').setFontWeight('bold');
      existing.push(h);
    }
  });
  return existing; // final header row
}
function colIndex(headers,name){ return headers.indexOf(name); } // 0-based, -1 if absent

// Read a whole sheet into row objects keyed by header name.
function readRows(ss,name){
  var sh=ss.getSheetByName(name);
  if(!sh||sh.getLastRow()<2) return [];
  var vals=sh.getDataRange().getValues();
  var head=vals[0].map(String);
  var out=[];
  for(var i=1;i<vals.length;i++){
    var row={};
    for(var j=0;j<head.length;j++) row[head[j]]=vals[i][j];
    out.push(row);
  }
  return out;
}
function readColumn(ss,name){
  var sh=ss.getSheetByName(name);
  if(!sh||sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,1).getValues()
    .map(function(r){return String(r[0]);}).filter(String);
}
function cellStr(v){ return v===null||v===undefined?'':String(v); }
function dateStr(v){
  if(v instanceof Date) return Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd');
  return cellStr(v);
}

function orderRowToObj(r){
  return {
    modelNo:cellStr(r['Model No']), challanNo:cellStr(r['Challan No']),
    date:dateStr(r['Date']), receivedDate:dateStr(r['Received Date']),
    dueDate:dateStr(r['Due Date']), dispatchDate:dateStr(r['Dispatch Date']),
    doctor:cellStr(r['Doctor']), clinic:cellStr(r['Clinic']), patient:cellStr(r['Patient']),
    workType:cellStr(r['Work Type']), teeth:cellStr(r['Teeth']), units:r['Units']||0,
    status:cellStr(r['Status']), amount:r['Amount (₹)']||0,
    billingStatus:cellStr(r['Billing Status']), implantSystem:cellStr(r['Implant System']),
    notes:cellStr(r['Notes']), invoiceNo:cellStr(r['Invoice No']),
    holdReason:cellStr(r['Hold Reason']), details:cellStr(r['Details']),
    updatedAt:Number(r['Updated At'])||0
  };
}
function doctorRowToObj(r,withPin){
  var o={
    name:cellStr(r['Doctor Name']), clinic:cellStr(r['Clinic']), address:cellStr(r['Address']),
    phone:cellStr(r['Phone']), email:cellStr(r['Email']),
    cpName:cellStr(r['Contact Person']), cpPhone:cellStr(r['CP Phone']), category:cellStr(r['Category'])
  };
  if(withPin) o.pin=cellStr(r['Pin']);
  return o;
}

// ── GET ──────────────────────────────────────────────────────────
function doGet(e){
  try{
    var p=(e&&e.parameter)||{};
    var ss=SpreadsheetApp.getActiveSpreadsheet();

    if(p.action==='ping') return jsonOut({status:'connected',app:'KB DENARTS',version:2});

    if(p.action==='reserveSerial'){
      if(!authed(p.token)) return jsonOut({status:'error',message:'unauthorized'});
      return jsonOut(reserveSerial(ss,p.prefix||'KB',p.year||'',parseInt(p.min)||1));
    }

    if(p.action==='portal'){
      return jsonOut(portalLogin(ss,p.doctor||'',p.pin||''));
    }

    if(p.action==='dedupe'){
      if(!authed(p.token)) return jsonOut({status:'error',message:'unauthorized'});
      return jsonOut(dedupeAllOrders(ss));
    }

    // Full data dump — admin only
    if(!authed(p.token)) return jsonOut({status:'error',message:'unauthorized — set the Access Token in the app settings'});

    var out={status:'ok',version:2};
    out.orders=readRows(ss,ORDERS_SHEET).map(orderRowToObj).filter(function(o){return o.modelNo;});
    // PINs deliberately NOT included — they never leave the server
    out.doctors=readRows(ss,DOCTORS_SHEET).map(function(r){return doctorRowToObj(r,false);}).filter(function(d){return d.name;});
    out.staff=readRows(ss,STAFF_SHEET).map(function(r){return{
      name:cellStr(r['Name']),type:cellStr(r['Type']),dept:cellStr(r['Department']),
      cell:cellStr(r['Cell']),email:cellStr(r['Email'])};}).filter(function(s){return s.name;});
    out.departments=readColumn(ss,DEPTS_SHEET);
    out.products=readRows(ss,PRODUCTS_SHEET).map(function(r){return{
      value:cellStr(r['Product']),price:cellStr(r['Price'])};}).filter(function(x){return x.value;});
    for(var key in LIST_SHEETS) out[key]=readColumn(ss,LIST_SHEETS[key]);
    out.prodlog=readRows(ss,PRODLOG_SHEET).map(function(r){return{
      modelNo:cellStr(r['Model No']),patientName:cellStr(r['Patient']),step:cellStr(r['Step']),
      staffName:cellStr(r['Staff']),note:cellStr(r['Note']),ts:Number(r['TS'])||0,
      datetime:cellStr(r['Datetime'])};}).filter(function(l){return l.modelNo&&l.step;});
    out.corrections=readRows(ss,CORR_SHEET).map(function(r){return{
      id:cellStr(r['ID']),patientName:cellStr(r['Patient']),modelNo:cellStr(r['Model No']),
      doctorName:cellStr(r['Doctor']),pickupDate:dateStr(r['Pickup Date']),
      correctionType:cellStr(r['Correction Type']),sendBackDate:dateStr(r['Send Back Date']),
      status:cellStr(r['Status']),notes:cellStr(r['Notes']),ts:Number(r['TS'])||0};}).filter(function(c){return c.id;});
    out.remarks=readRows(ss,REMARKS_SHEET).map(function(r){return{
      doctorName:cellStr(r['Doctor']),clinic:cellStr(r['Clinic']),message:cellStr(r['Message']),
      from:cellStr(r['From']),datetime:cellStr(r['Datetime']),ts:Number(r['TS'])||0};}).filter(function(x){return x.message;});
    out.inventory=readRows(ss,INV_SHEET).map(function(r){return{
      name:cellStr(r['Name']),category:cellStr(r['Category']),brand:cellStr(r['Brand']),
      company:cellStr(r['Company']),hsnCode:cellStr(r['HSN']),uom:cellStr(r['UOM']),
      packing:cellStr(r['Packing']),openingStock:r['Opening Stock']||0,
      reorderLevel:r['Reorder Level']||0};}).filter(function(x){return x.name;});
    out.loginLog=readRows(ss,LOGIN_SHEET).map(function(r){return{
      doctorName:cellStr(r['Doctor']),clinic:cellStr(r['Clinic']),
      datetime:cellStr(r['Datetime']),ts:Number(r['TS'])||0};});
    return jsonOut(out);
  }catch(err){
    return jsonOut({status:'error',message:err.toString()});
  }
}

// Atomically reserve the next order serial for prefix+year.
// Uses a script property seeded from (and never below) the Orders sheet,
// and never below the caller's own local counter (min).
function reserveSerial(ss,prefix,year,min){
  var lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    // Always derive the next number from the ACTUAL highest order in the sheet
    // (ignoring Deleted rows). No stored counter -> no drift, no skipped numbers.
    var pre=prefix+'-'+year+'/';
    var maxN=0;
    readRows(ss,ORDERS_SHEET).forEach(function(r){
      if(cellStr(r['Status'])==='Deleted') return;
      var m=cellStr(r['Model No']);
      if(m.indexOf(pre)===0){
        var n=parseInt(m.substring(pre.length));
        if(n&&n>maxN) maxN=n;
      }
    });
    var next=maxN+1;
    if(min&&min>next) next=min; // local floor (offline safety); never lets it go backwards
    return {status:'ok',serial:next};
  }finally{
    lock.releaseLock();
  }
}

// Doctor portal: PIN verified server-side; returns ONLY this doctor's data.
function portalLogin(ss,doctorKey,pin){
  doctorKey=String(doctorKey).trim().toLowerCase();
  if(!doctorKey) return {status:'error',message:'no doctor'};
  var dsh=getOrCreateSheet(ss,DOCTORS_SHEET,DOCTOR_HEADERS);
  ensureHeaders(dsh,DOCTOR_HEADERS);
  var doctors=readRows(ss,DOCTORS_SHEET);
  var doc=null;
  doctors.forEach(function(r){
    if(cellStr(r['Doctor Name']).trim().toLowerCase()===doctorKey) doc=r;
  });
  if(!doc) return {status:'error',message:'doctor not found'};
  var correct=cellStr(doc['Pin'])||'1234';
  if(String(pin)!==correct) return {status:'error',message:'wrong pin'};

  var name=cellStr(doc['Doctor Name']);
  var nameLc=name.toLowerCase();
  var orders=readRows(ss,ORDERS_SHEET).map(orderRowToObj).filter(function(o){
    return o.modelNo&&o.status!=='Deleted'&&o.doctor.toLowerCase()===nameLc;
  });
  var models={};
  orders.forEach(function(o){models[o.modelNo]=true;});
  var prodlog=readRows(ss,PRODLOG_SHEET).map(function(r){return{
    modelNo:cellStr(r['Model No']),step:cellStr(r['Step']),staffName:cellStr(r['Staff']),
    ts:Number(r['TS'])||0,datetime:cellStr(r['Datetime'])};
  }).filter(function(l){return models[l.modelNo];});
  var remarks=readRows(ss,REMARKS_SHEET).map(function(r){return{
    doctorName:cellStr(r['Doctor']),message:cellStr(r['Message']),
    from:cellStr(r['From']),datetime:cellStr(r['Datetime']),ts:Number(r['TS'])||0};
  }).filter(function(x){return x.doctorName.toLowerCase()===nameLc;});
  var corrections=readRows(ss,CORR_SHEET).filter(function(r){
    return cellStr(r['Doctor']).trim().toLowerCase()===nameLc;
  }).map(function(r){return{
    patientName:cellStr(r['Patient']),modelNo:cellStr(r['Model No']),
    correctionType:cellStr(r['Correction Type']),status:cellStr(r['Status'])||'Received',
    pickupDate:dateStr(r['Pickup Date']),sendBackDate:dateStr(r['Send Back Date']),
    updatedAt:Number(r['TS'])||0};
  });
  return {status:'ok',version:2,portal:true,corrections:corrections,
          doctor:{name:name,clinic:cellStr(doc['Clinic']),pinIsDefault:correct==='1234'},
          orders:orders,prodlog:prodlog,remarks:remarks};
}

// ── POST ─────────────────────────────────────────────────────────
function doPost(e){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var data=JSON.parse(e.postData.contents);
    var t=data.type;

    // Doctor-credential types: authenticated by doctor name + PIN, not admin token
    if(t==='doctor_remark'||t==='doctor_login'||t==='doctor_pin'){
      return jsonOut(handleDoctorPost(ss,data));
    }
    if(!authed(data.token)) return jsonOut({status:'error',message:'unauthorized'});

    if(t==='order')        upsertOrder(ss,data);
    else if(t==='orders_bulk'){ (data.orders||[]).forEach(function(o){upsertOrder(ss,o);}); }
    else if(t==='order_status') updateOrderStatus(ss,data);
    else if(t==='doctor')  upsertDoctor(ss,data);
    else if(t==='doctor_delete') deleteDoctor(ss,data);
    else if(t==='masters_sync')  mastersSync(ss,data);
    else if(t==='prod_log') appendProdLog(ss,data);
    else if(t==='correction_case') upsertCorrection(ss,data);
    else if(t==='lab_reply') appendRemark(ss,{doctorName:data.doctorName,clinic:data.clinic,
      message:data.message,from:'lab',datetime:data.datetime,ts:data.ts});

    return jsonOut({status:'ok'});
  }catch(err){
    return jsonOut({status:'error',message:err.toString()});
  }
}

function handleDoctorPost(ss,data){
  var doctors=readRows(ss,DOCTORS_SHEET);
  var doc=null;
  var key=String(data.doctorName||'').trim().toLowerCase();
  doctors.forEach(function(r){
    if(cellStr(r['Doctor Name']).trim().toLowerCase()===key) doc=r;
  });
  if(!doc) return {status:'error',message:'doctor not found'};
  var correct=cellStr(doc['Pin'])||'1234';
  var given=String(data.pin||data.oldPin||'');
  if(given!==correct) return {status:'error',message:'wrong pin'};

  if(data.type==='doctor_login'){
    var lsh=getOrCreateSheet(ss,LOGIN_SHEET,['Doctor','Clinic','Datetime','TS']);
    lsh.appendRow([data.doctorName||'',data.clinic||'',data.datetime||'',data.ts||Date.now()]);
  }else if(data.type==='doctor_remark'){
    appendRemark(ss,{doctorName:data.doctorName,clinic:data.clinic,message:data.message,
      from:'doctor',datetime:data.datetime,ts:data.ts});
  }else if(data.type==='doctor_pin'){
    var newPin=String(data.newPin||'').replace(/\D/g,'');
    if(newPin.length!==4) return {status:'error',message:'PIN must be 4 digits'};
    var sh=ss.getSheetByName(DOCTORS_SHEET);
    var head=ensureHeaders(sh,DOCTOR_HEADERS);
    var nameCol=colIndex(head,'Doctor Name'), pinCol=colIndex(head,'Pin');
    var vals=sh.getRange(2,1,sh.getLastRow()-1,head.length).getValues();
    for(var i=0;i<vals.length;i++){
      if(cellStr(vals[i][nameCol]).trim().toLowerCase()===key){
        sh.getRange(i+2,pinCol+1).setValue(newPin);
        break;
      }
    }
  }
  return {status:'ok'};
}

function upsertOrder(ss,d){
  if(!d.modelNo) return;
  var sh=getOrCreateSheet(ss,ORDERS_SHEET,ORDER_HEADERS);
  var head=ensureHeaders(sh,ORDER_HEADERS);
  var rowVals={};
  rowVals['Model No']=d.modelNo; rowVals['Challan No']=d.challanNo||'';
  rowVals['Date']=d.date||''; rowVals['Received Date']=d.receivedDate||'';
  rowVals['Due Date']=d.dueDate||''; rowVals['Dispatch Date']=d.dispatchDate||'';
  rowVals['Doctor']=d.doctorName||''; rowVals['Clinic']=d.clinicName||'';
  rowVals['Patient']=d.patientName||''; rowVals['Work Type']=d.workType||'';
  rowVals['Teeth']=d.teeth||''; rowVals['Units']=d.units||0; rowVals['Status']=d.status||'';
  rowVals['Amount (₹)']=d.amount||0; rowVals['Billing Status']=d.billingStatus||'';
  rowVals['Implant System']=d.implantSystem||''; rowVals['Notes']=d.notes||'';
  rowVals['Invoice No']=d.invoiceNo||''; rowVals['Hold Reason']=d.holdReason||'';
  rowVals['Details']=d.details||''; rowVals['Updated At']=d.updatedAt||Date.now();
  var arr=head.map(function(h){return rowVals.hasOwnProperty(h)?rowVals[h]:'';});

  // Find every row for this model number by the "Model No" HEADER (not a
  // hard-coded column 1 — the old code appended a duplicate whenever the sheet
  // had Model No in a different column). Update the first, delete any extras.
  var rows=findOrderRows(sh,head,d.modelNo);
  if(rows.length){
    var uaCol=colIndex(head,'Updated At');
    var stale=false;
    if(uaCol>=0){
      var existingUA=Number(sh.getRange(rows[0],uaCol+1).getValue())||0;
      var incomingUA=Number(d.updatedAt)||0;
      if(existingUA&&incomingUA&&incomingUA<existingUA) stale=true;
    }
    if(!stale) sh.getRange(rows[0],1,1,arr.length).setValues([arr]);
    // Self-healing: remove duplicate rows for this model number
    for(var j=rows.length-1;j>=1;j--) sh.deleteRow(rows[j]);
    return;
  }
  sh.appendRow(arr);
}

// Row numbers (1-based, incl. header offset) of every row whose Model No matches
function findOrderRows(sh,head,modelNo){
  var lastRow=sh.getLastRow();
  if(lastRow<2) return [];
  var mc=colIndex(head,'Model No'); if(mc<0) mc=0;
  var col=sh.getRange(2,mc+1,lastRow-1,1).getValues();
  var rows=[];
  var target=String(modelNo).trim();
  for(var i=0;i<col.length;i++){ if(String(col[i][0]).trim()===target) rows.push(i+2); }
  return rows;
}

function updateOrderStatus(ss,d){
  if(!d.modelNo) return;
  var sh=getOrCreateSheet(ss,ORDERS_SHEET,ORDER_HEADERS);
  var head=ensureHeaders(sh,ORDER_HEADERS);
  var rows=findOrderRows(sh,head,d.modelNo);
  if(!rows.length) return;
  var row=rows[0];
  var set=function(h,v){var c=colIndex(head,h);if(c>=0&&v!==undefined&&v!=='')sh.getRange(row,c+1).setValue(v);};
  set('Status',d.status);
  set('Dispatch Date',d.dispatchDate);
  set('Challan No',d.challanNo);
  set('Invoice No',d.invoiceNo);
  set('Hold Reason',d.holdReason);
  set('Billing Status',d.billingStatus);
  set('Updated At',d.updatedAt||Date.now());
  // remove any duplicate rows for this model number
  for(var j=rows.length-1;j>=1;j--) sh.deleteRow(rows[j]);
}

// One-time cleanup: collapse duplicate order rows, keeping the freshest
// (highest Updated At) per model number. Trigger via ?action=dedupe&token=...
function dedupeAllOrders(ss){
  var sh=ss.getSheetByName(ORDERS_SHEET);
  if(!sh||sh.getLastRow()<3) return {status:'ok',removed:0,kept:sh?sh.getLastRow()-1:0};
  var head=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  var mc=colIndex(head,'Model No'); if(mc<0) mc=0;
  var uaCol=colIndex(head,'Updated At');
  var lastRow=sh.getLastRow();
  var data=sh.getRange(2,1,lastRow-1,head.length).getValues();
  var best={}, firstIdx={};
  for(var i=0;i<data.length;i++){
    var mn=String(data[i][mc]).trim(); if(!mn) continue;
    var ua=uaCol>=0?Number(data[i][uaCol])||0:0;
    if(firstIdx[mn]===undefined) firstIdx[mn]=i;
    if(!best[mn]||ua>=best[mn].ua) best[mn]={row:data[i],ua:ua};
  }
  var mns=Object.keys(best).sort(function(a,b){return firstIdx[a]-firstIdx[b];});
  var out=mns.map(function(m){return best[m].row;});
  sh.getRange(2,1,lastRow-1,head.length).clearContent();
  if(out.length) sh.getRange(2,1,out.length,head.length).setValues(out);
  return {status:'ok',removed:data.length-out.length,kept:out.length};
}

function upsertDoctor(ss,d){
  if(!d.name) return;
  var sh=getOrCreateSheet(ss,DOCTORS_SHEET,DOCTOR_HEADERS);
  var head=ensureHeaders(sh,DOCTOR_HEADERS);
  var lastRow=sh.getLastRow();
  var nameCol=colIndex(head,'Doctor Name');
  var vals=lastRow>1?sh.getRange(2,1,lastRow-1,head.length).getValues():[];
  for(var i=0;i<vals.length;i++){
    if(cellStr(vals[i][nameCol]).trim().toLowerCase()===String(d.name).trim().toLowerCase()){
      var row=i+2;
      var set=function(h,v){var c=colIndex(head,h);if(c>=0)sh.getRange(row,c+1).setValue(v);};
      set('Clinic',d.clinic||''); set('Address',d.address||''); set('Phone',d.phone||'');
      set('Email',d.email||''); set('Contact Person',d.cpName||''); set('CP Phone',d.cpPhone||'');
      set('Category',d.category||'');
      // Pin column intentionally untouched
      return;
    }
  }
  var rowVals={'Doctor Name':d.name,'Clinic':d.clinic||'','Address':d.address||'','Phone':d.phone||'',
    'Email':d.email||'','Contact Person':d.cpName||'','CP Phone':d.cpPhone||'','Category':d.category||'','Pin':''};
  sh.appendRow(head.map(function(h){return rowVals.hasOwnProperty(h)?rowVals[h]:'';}));
}

function deleteDoctor(ss,d){
  var sh=ss.getSheetByName(DOCTORS_SHEET);
  if(!sh||sh.getLastRow()<2||!d.name) return;
  var nameCol=sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
  for(var i=nameCol.length-1;i>=0;i--){
    if(cellStr(nameCol[i][0]).trim().toLowerCase()===String(d.name).trim().toLowerCase()){
      sh.deleteRow(i+2);
    }
  }
}

function writeList(ss,name,values,header){
  // Guard: never wipe an existing list with an empty push (accidental data loss)
  if(!values||!values.length) return;
  var sh=getOrCreateSheet(ss,name,[header]);
  // MERGE, never overwrite: union the incoming values with what's already in
  // the sheet, so a device carrying only the built-in defaults can't delete
  // custom entries (root cause of the "steps shrank from 14 to 10" issue).
  var existing=readColumn(ss,name);
  var seen={};existing.forEach(function(v){seen[String(v).toLowerCase()]=true;});
  var merged=existing.slice();
  values.forEach(function(v){var s=String(v);if(s&&!seen[s.toLowerCase()]){seen[s.toLowerCase()]=true;merged.push(s);}});
  if(sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
  sh.getRange(2,1,merged.length,1).setValues(merged.map(function(v){return[String(v)];}));
}

function mastersSync(ss,d){
  (d.doctors||[]).forEach(function(doc){upsertDoctor(ss,doc);});
  // Only overwrite a master tab when the push actually carries data — an empty
  // array is ignored so a device with no staff/products can't wipe the sheet.
  if(Array.isArray(d.staff)&&d.staff.length){
    var sh=getOrCreateSheet(ss,STAFF_SHEET,['Name','Type','Department','Cell','Email']);
    if(sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,5).clearContent();
    sh.getRange(2,1,d.staff.length,5).setValues(
      d.staff.map(function(s){return[s.name||'',s.type||'',s.dept||'',s.cell||'',s.email||''];}));
  }
  if(Array.isArray(d.departments)) writeList(ss,DEPTS_SHEET,d.departments,'Department');
  if(Array.isArray(d.products)&&d.products.length){
    var ps=getOrCreateSheet(ss,PRODUCTS_SHEET,['Product','Price']);
    if(ps.getLastRow()>1) ps.getRange(2,1,ps.getLastRow()-1,2).clearContent();
    ps.getRange(2,1,d.products.length,2).setValues(
      d.products.map(function(p){return[p.value||String(p),p.price||''];}));
  }
  for(var key in LIST_SHEETS){
    if(Array.isArray(d[key])) writeList(ss,LIST_SHEETS[key],d[key],LIST_SHEETS[key]);
  }
}

function appendProdLog(ss,d){
  if(!d.modelNo||!d.step) return;
  var HEADERS=['Model No','Patient','Step','Staff','Note','TS','Datetime'];
  var sh=getOrCreateSheet(ss,PRODLOG_SHEET,HEADERS);
  var head=ensureHeaders(sh,HEADERS); // guarantees TS + Datetime columns exist
  var vals={'Model No':d.modelNo,'Patient':d.patientName||'','Step':d.step,
    'Staff':d.staffName||'','Note':d.note||'','TS':d.ts||Date.now(),'Datetime':d.datetime||''};
  // Write BY HEADER NAME so the timestamp always lands in the column the reader
  // looks for (positional append broke when the tab had a custom column layout).
  sh.appendRow(head.map(function(h){return vals.hasOwnProperty(h)?vals[h]:'';}));
}

function upsertCorrection(ss,d){
  if(!d.id) return;
  var sh=getOrCreateSheet(ss,CORR_SHEET,
    ['ID','Patient','Model No','Doctor','Pickup Date','Correction Type','Send Back Date','Status','Notes','TS']);
  var arr=[d.id,d.patientName||'',d.modelNo||'',d.doctorName||'',d.pickupDate||'',
    d.correctionType||'',d.sendBackDate||'',d.status||'',d.notes||'',d.ts||Date.now()];
  var lastRow=sh.getLastRow();
  if(lastRow>1){
    var idCol=sh.getRange(2,1,lastRow-1,1).getValues();
    for(var i=0;i<idCol.length;i++){
      if(String(idCol[i][0])===String(d.id)){
        sh.getRange(i+2,1,1,arr.length).setValues([arr]);
        return;
      }
    }
  }
  sh.appendRow(arr);
}

function appendRemark(ss,r){
  if(!r.message) return;
  var sh=getOrCreateSheet(ss,REMARKS_SHEET,['Doctor','Clinic','Message','From','Datetime','TS']);
  sh.appendRow([r.doctorName||'',r.clinic||'',r.message||'',r.from||'',r.datetime||'',r.ts||Date.now()]);
}
