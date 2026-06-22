/* @jsxRuntime classic */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const PWD_KEY = 'arise_sys_pwd';
const SIG_KEY = 'arise_pdf_signatures'; 
const MONTH_KEY = 'arise_active_month_v6';

// Persistent Local Workspace DB Config
const IDB_DB_NAME = "arise_directory_db_v1";
const IDB_STORE_NAME = "handles";
const IDB_KEY = "folder_sync_handle";

// IndexedDB Helper utilities
const saveHandleToIDB = async (handle) => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                db.createObjectStore(IDB_STORE_NAME);
            }
        };
        request.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction(IDB_STORE_NAME, "readwrite");
            const store = tx.objectStore(IDB_STORE_NAME);
            const putReq = store.put(handle, IDB_KEY);
            putReq.onsuccess = () => resolve();
            putReq.onerror = () => reject(putReq.error);
        };
        request.onerror = () => reject(request.error);
    });
};

const loadHandleFromIDB = async () => {
    return new Promise((resolve) => {
        const request = indexedDB.open(IDB_DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                db.createObjectStore(IDB_STORE_NAME);
            }
        };
        request.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction(IDB_STORE_NAME, "readonly");
            const store = tx.objectStore(IDB_STORE_NAME);
            const getReq = store.get(IDB_KEY);
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => resolve(null);
        };
        request.onerror = () => resolve(null);
    });
};

// Support for 2 Isolated Months Configuration
const MONTHS = [
    { id: 'MAY_2026', label: 'May 2026', short: 'MAY-26', days: 31, weekends: [3, 10, 17, 24, 31], startOffset: 4, dbKey: 'arise_modern_db_v5' },
    { id: 'JUN_2026', label: 'June 2026', short: 'JUN-26', days: 30, weekends: [7, 14, 21, 28], startOffset: 0, dbKey: 'arise_modern_db_jun_26' }
];

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Date Formatter Helper
const formatDate = (dStr) => {
    if(!dStr) return "";
    const pts = dStr.split('-');
    if(pts.length === 3) return `${pts[2]}/${pts[1]}/${pts[0]}`;
    return dStr;
};

// Time Options Generators
const generateTimeOptions = (startHr, startMin, endHr, endMin) => {
    const times = [];
    let h = startHr, m = startMin;
    while (h < endHr || (h === endHr && m <= endMin)) {
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        const displayM = m.toString().padStart(2, '0');
        times.push(`${displayH}:${displayM} ${ampm}`);
        m += 5;
        if (m >= 60) { m -= 60; h++; }
    }
    return times;
};

// Expanded time options to cover the new early/late OT rules
const inTimeOptions = generateTimeOptions(7, 30, 11, 0); // 7:30 AM to 11:00 AM
const outTimeOptions = generateTimeOptions(15, 30, 21, 0); // 3:30 PM to 9:00 PM

const SUGGESTED_IN_TIMES = ['8:00 AM', '9:00 AM', '9:30 AM', '10:00 AM'];
const SUGGESTED_OUT_TIMES = ['5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM'];

const formatTimeInput = (time24) => {
    if(!time24) return "";
    let [h, m] = time24.split(':');
    h = parseInt(h, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
};

// --- AUTO OT CALCULATION LOGIC ---
const parseTimeMins = (timeStr) => {
    if (!timeStr) return null;
    const [time, modifier] = timeStr.split(' ');
    if (!time || !modifier) return null;
    let [hours, minutes] = time.split(':').map(Number);
    if (hours === 12) hours = 0;
    if (modifier.toUpperCase() === 'PM') hours += 12;
    return hours * 60 + minutes;
};

const calculateAutoOT = (inStr, outStr) => {
    const inMins = parseTimeMins(inStr);
    const outMins = parseTimeMins(outStr);
    let ot = 0;

    // IN TIME Rules
    if (inMins !== null) {
        if (inMins >= 470 && inMins <= 504) ot += 1.0;       // 07:50 - 08:24
        else if (inMins >= 505 && inMins <= 520) ot += 0.5;  // 08:25 - 08:40
        else if (inMins >= 551 && inMins <= 584) ot -= 0.5;  // 09:11 - 09:44
        else if (inMins >= 585 && inMins <= 610) ot -= 1.0;  // 09:45 - 10:10
    }

    // OUT TIME Rules
    if (outMins !== null) {
        if (outMins >= 955 && outMins <= 975) ot -= 1.5;       // 15:55 - 16:15 (Early Penalty)
        else if (outMins >= 976 && outMins <= 1004) ot -= 1.0; // 16:16 - 16:44 (Early Penalty)
        else if (outMins >= 1005 && outMins <= 1040) ot -= 0.5;// 16:45 - 17:20 (Early Penalty)
        else if (outMins >= 1065 && outMins <= 1094) ot += 0.5;// 17:45 - 18:14 (OT)
        else if (outMins >= 1095 && outMins <= 1125) ot += 1.0;// 18:15 - 18:45 (OT)
        else if (outMins >= 1126 && outMins <= 1155) ot += 1.5;// 18:46 - 19:15 (OT)
        else if (outMins >= 1156 && outMins <= 1185) ot += 2.0;// 19:16 - 19:45 (OT)
    }

    return ot;
};
// ---------------------------------

// Dynamic Computation
const compute = (emp, monthConf) => {
    let pr = 0, pOnly = 0, ab = 0, ot = 0, t = 0, wo = 0, h = 0, pMiss = 0, leave = 0;
    let autoWoDays = {};
    const isE = String(emp.type || "").trim().toUpperCase() === "E";
    const { days, weekends } = monthConf;

    for (let w of weekends) {
        if (!emp[`d${w}`]) {
            let sum = 0;
            for (let i = Math.max(1, w - 6); i < w; i++) {
                const a = String(emp[`d${i}`] || "").trim().toUpperCase();
                if (a === 'P' || a === 'P?' || a === 'T' || a === 'W/O' || a === 'L') sum += 1;
                if (a === '0.5' || a === 'H') sum += 0.5;
            }
            if (sum >= 4) autoWoDays[w] = "W/O";
        }
    }

    for (let i = 1; i <= days; i++) {
        const manual = String(emp[`d${i}`] || "").trim().toUpperCase();
        const a = manual || autoWoDays[i] || "";
        const isSunday = weekends.includes(i);
        const o = String(emp[`ot${i}`] || "").trim();

        let getsExtraWo = false;
        if (isE && isSunday && manual && ['P', 'P?', 'H', '0.5', 'T', 'L'].includes(manual)) getsExtraWo = true;

        if (a === "P") { pr += 1; pOnly += 1; }
        else if (a === "P?") { pr += 1; pOnly += 1; pMiss += 1; } 
        else if (a === "T") { pr += 1; t += 1; }
        else if (a === "L") { pr += 1; leave += 1; }
        else if (a === "W/O") { pr += 1; wo += 1; }
        else if (a === "0.5" || a === "H") { pr += 0.5; h += 1; }
        else if (a === "A") ab += 1;

        if (getsExtraWo) { pr += 1; wo += 1; }
        if (o && !isNaN(parseFloat(o))) ot += parseFloat(o);
    }

    const bas = parseFloat(emp.basicSalary) || 0;
    const pBal = parseFloat(emp.previousBalance) || 0;
    const adv = parseFloat(emp.advance) || 0;
    const pd = bas > 0 ? bas / days : 0;
    const ph = pd > 0 ? pd / 8.5 : 0;
    
    const ms = Math.round(pr * pd);
    const dos = Math.round(ot * ph);
    const act = ms + dos;
    const bal = act + pBal;
    const pay = bal - adv;

    return { 
        ...emp, 
        present: pr, pOnly, absent: ab, otHrs: ot, tour: t, wo, half: h, pMiss, leave, autoWoDays, 
        workingDays: pr, perDaySalary: pd, perHrSalary: ph, monthlySalary: ms, 
        dailyOtSalary: dos, actualMonthly: act, balance: bal, salaryToBePaid: pay,
        joiningDate: emp.joiningDate || ""
    };
};

const defaultEmp = (monthConf) => {
    const e = { id: Date.now().toString(), name: "New Employee", dept: "PRODUCTION", code: `EMP-${Math.floor(Math.random()*1000)}`, type: "E", basicSalary: 0, previousBalance: 0, advance: 0, joiningDate: "" };
    for (let i = 1; i <= monthConf.days; i++) { e[`d${i}`] = ""; e[`ot${i}`] = ""; e[`c${i}`] = ""; e[`in${i}`] = ""; e[`out${i}`] = ""; }
    return compute(e, monthConf);
};

const Icon = ({ path, className="w-5 h-5" }) => (
<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ width: '1.1rem', height: '1.1rem', display: 'inline-block' }}>
<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={path}></path>
</svg>
);

const OwnerDashboard = ({ db, activeConf }) => {
    const stats = useMemo(() => {
        let totalBasic = 0, totalEarned = 0, totalPayout = 0, totalAdvance = 0, totalOTCost = 0, totalOTHours = 0;
        let totalAbsent = 0, totalPresent = 0, totalMissingPunches = 0;
        const deptCosts = {};
        const newJoiners = [];

        db.forEach(emp => {
            totalBasic += (parseFloat(emp.basicSalary) || 0);
            totalEarned += (parseFloat(emp.actualMonthly) || 0);
            totalPayout += Math.max(0, parseFloat(emp.salaryToBePaid) || 0); 
            totalAdvance += (parseFloat(emp.advance) || 0);
            totalOTCost += (parseFloat(emp.dailyOtSalary) || 0);
            totalOTHours += (parseFloat(emp.otHrs) || 0);
            totalAbsent += (parseFloat(emp.absent) || 0);
            totalPresent += (parseFloat(emp.workingDays) || 0);
            totalMissingPunches += (parseFloat(emp.pMiss) || 0);

            const dept = emp.dept || "Uncategorized";
            if (!deptCosts[dept]) deptCosts[dept] = 0;
            const pay = parseFloat(emp.salaryToBePaid) || 0;
            deptCosts[dept] += (pay > 0 ? pay : 0);

            if (emp.joiningDate && emp.joiningDate.trim() !== "") {
                newJoiners.push(emp);
            }
        });

        const expectedDays = db.length * activeConf.days;
        const attRate = expectedDays ? ((totalPresent / expectedDays) * 100).toFixed(1) : 0;
        const sortedDepts = Object.entries(deptCosts).sort((a,b) => b[1] - a[1]);

        const insights = [];
        if (attRate < 85 && db.length > 0) insights.push({ type: 'warning', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', color: 'text-warning', title: 'High Absenteeism Rate', msg: `Overall attendance is at ${attRate}%. Consider reviewing leave patterns or issues affecting the workforce.` });
        if (totalOTCost > (totalBasic * 0.15) && db.length > 0) insights.push({ type: 'error', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6', color: 'text-danger', title: 'Excessive Overtime Costs', msg: `OT accounts for >15% of basic payroll (₹${totalOTCost.toLocaleString(undefined, {maximumFractionDigits:0})}). Consider adjusting shift timings to reduce burnout.` });
        if (totalMissingPunches > (db.length * 1.5) && db.length > 0) insights.push({ type: 'info', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', color: 'text-info', title: 'Frequent Missing Punches', msg: `Detected ${totalMissingPunches} missing punch-outs (P?). Enforce stricter punch rules.` });
        if (totalAdvance > (totalEarned * 0.2) && db.length > 0) insights.push({ type: 'warning', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-warning', title: 'High Advance Dependency', msg: 'Employees have requested over 20% of their earned salaries as advance payments. Review loan policies.' });
        if (insights.length === 0 && db.length > 0) insights.push({ type: 'success', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-success', title: 'System Healthy', msg: 'Payroll and attendance metrics are well within healthy operational thresholds. No critical actions required.' });

        const topAbsent = [...db].sort((a, b) => (parseFloat(b.absent)||0) - (parseFloat(a.absent)||0)).slice(0, 5).filter(e => e.absent > 0);
        const topOT = [...db].sort((a, b) => (parseFloat(b.otHrs)||0) - (parseFloat(a.otHrs)||0)).slice(0, 5).filter(e => e.otHrs > 0);

        return { totalBasic, totalPayout, totalAdvance, totalOTCost, totalOTHours, totalAbsent, attRate, sortedDepts, insights, topAbsent, topOT, newJoiners };
    }, [db, activeConf]);

    return (
        <div className="flex-grow-1 overflow-auto p-4 p-lg-5 hide-scroll bg-light d-flex flex-column gap-4">
            <div className="d-flex justify-content-between align-items-end mb-2">
                <div>
                    <h2 className="h2 fw-bold text-dark mb-0">Executive Analytics</h2>
                    <p className="small text-muted mt-1 fw-semibold">Detailed financial and operational overview for {activeConf.label}.</p>
                </div>
                <div className="small fw-bold text-secondary bg-white px-3 py-2 rounded border shadow-sm d-flex align-items-center gap-2" style={{ fontSize: '11px' }}>
                    <div className="rounded-circle bg-success animate-pulse" style={{ width: '8px', height: '8px' }}></div>
                    Live Data
                </div>
            </div>

            <div className="row row-cols-1 row-cols-md-2 row-cols-lg-4 g-3">
                {/* Net Payout Card */}
                <div className="col">
                    <div className="card h-100 bg-white p-4 shadow-sm border-0 border-start border-primary border-4 rounded d-flex flex-column justify-content-between">
                        <div className="d-flex justify-content-between align-items-start mb-3">
                            <div className="rounded bg-brand-50 text-brand-600 d-flex align-items-center justify-content-center" style={{ width: '40px', height: '40px' }}>
                                <Icon path="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </div>
                            <span className="badge bg-brand-100 text-brand-700" style={{ fontSize: '10px' }}>PAYOUT</span>
                        </div>
                        <div>
                            <div className="h3 fw-bold text-dark mb-1">₹{stats.totalPayout.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                            <p className="small text-muted mb-0 fw-semibold">Net payable after deductions</p>
                        </div>
                    </div>
                </div>

                {/* Advance Card */}
                <div className="col">
                    <div className="card h-100 bg-white p-4 shadow-sm border-0 border-start border-danger border-4 rounded d-flex flex-column justify-content-between">
                        <div className="d-flex justify-content-between align-items-start mb-3">
                            <div className="rounded bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style={{ width: '40px', height: '40px' }}>
                                <Icon path="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"/>
                            </div>
                            <span className="badge bg-danger bg-opacity-10 text-danger" style={{ fontSize: '10px' }}>ADVANCE</span>
                        </div>
                        <div>
                            <div className="h3 fw-bold text-danger mb-1">₹{stats.totalAdvance.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                            <p className="small text-muted mb-0 fw-semibold">Total advances to deduct</p>
                        </div>
                    </div>
                </div>

                {/* OT Cost Card */}
                <div className="col">
                    <div className="card h-100 bg-white p-4 shadow-sm border-0 border-start border-warning border-4 rounded d-flex flex-column justify-content-between">
                        <div className="d-flex justify-content-between align-items-start mb-3">
                            <div className="rounded bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style={{ width: '40px', height: '40px' }}>
                                <Icon path="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </div>
                            <span className="badge bg-warning bg-opacity-10 text-warning" style={{ fontSize: '10px' }}>O.T COST</span>
                        </div>
                        <div>
                            <div className="h3 fw-bold text-warning mb-1">₹{stats.totalOTCost.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                            <p className="small text-muted mb-0 fw-semibold">Across {stats.totalOTHours} total hours logged</p>
                        </div>
                    </div>
                </div>

                {/* Attendance Card */}
                <div className="col">
                    <div className="card h-100 bg-white p-4 shadow-sm border-0 border-start border-success border-4 rounded d-flex flex-column justify-content-between">
                        <div className="d-flex justify-content-between align-items-start mb-3">
                            <div className="rounded bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style={{ width: '40px', height: '40px' }}>
                                <Icon path="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                            </div>
                            <span className="badge bg-success bg-opacity-10 text-success" style={{ fontSize: '10px' }}>ATTENDANCE</span>
                        </div>
                        <div>
                            <div className="h3 fw-bold text-success mb-1">{stats.attRate}%</div>
                            <p className="small text-muted mb-0 fw-semibold">Overall operational strength</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card p-4 border shadow-sm position-relative overflow-hidden bg-white rounded-3">
                <h3 className="h5 fw-bold text-dark mb-4 d-flex align-items-center gap-2 position-relative z-1"><Icon path="M13 10V3L4 14h7v7l9-11h-7z" className="text-brand-500"/> System Insights & Recommendations</h3>
                <div className="row g-3 position-relative z-1">
                    {stats.insights.length === 0 ? (
                        <div className="col-12 text-center text-secondary py-4 bg-light rounded border border-dashed">Not enough data to generate insights yet.</div>
                    ) : stats.insights.map((ins, idx) => {
                        const isWarning = ins.type === 'warning';
                        const isError = ins.type === 'error';
                        const isInfo = ins.type === 'info';
                        let bgClass = "bg-brand-50";
                        let textColorClass = "text-brand-600";
                        let borderLeftColor = "var(--brand-500)";
                        
                        if (isWarning) { borderLeftColor = "#ffc107"; bgClass = "bg-warning bg-opacity-10"; textColorClass = "text-warning-emphasis"; }
                        else if (isError) { borderLeftColor = "#dc3545"; bgClass = "bg-danger bg-opacity-10"; textColorClass = "text-danger"; }
                        else if (isInfo) { borderLeftColor = "#0dcaf0"; bgClass = "bg-info bg-opacity-10"; textColorClass = "text-info-emphasis"; }
                        
                        return (
                            <div key={idx} className="col-12 col-md-6">
                                <div className={`d-flex align-items-start gap-3 p-3 rounded border h-100 ${bgClass}`} style={{ borderLeft: `4px solid ${borderLeftColor}` }}>
                                    <div className={`p-2 bg-white rounded shadow-sm d-flex align-items-center justify-content-center ${textColorClass}`} style={{ width: '36px', height: '36px' }}>
                                        <Icon path={ins.icon} className="w-5 h-5"/>
                                    </div>
                                    <div>
                                        <h5 className={`h6 fw-bold mb-1 ${textColorClass}`}>{ins.title}</h5>
                                        <p className="small mb-0 text-muted fw-semibold" style={{ fontSize: '12px' }}>{ins.msg}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="row g-3">
                {/* Department Costs */}
                <div className="col-12 col-lg-4">
                    <div className="card h-100 p-4 border shadow-sm bg-white rounded-3 d-flex flex-column">
                        <h3 className="small fw-bold text-uppercase text-secondary tracking-widest mb-4">Department Costs</h3>
                        <div className="d-flex flex-column gap-3 flex-grow-1">
                            {stats.sortedDepts.length === 0 ? <p className="small text-muted text-center my-4 fw-semibold">No data.</p> : stats.sortedDepts.map(([dept, cost], idx) => {
                                const max = stats.sortedDepts[0][1] || 1;
                                const pct = ((cost / max) * 100).toFixed(0);
                                return (
                                    <div key={idx}>
                                        <div className="d-flex justify-content-between align-items-end small fw-bold mb-1">
                                            <span className="text-secondary text-truncate pr-2 text-uppercase" style={{ fontSize: '11px', letterSpacing: '0.5px' }}>{dept}</span>
                                            <span className="text-dark fw-bold">₹{cost.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                                        </div>
                                        <div className="progress" style={{ height: '8px' }}>
                                            <div className="progress-bar bg-brand-600" role="progressbar" style={{ width: `${pct}%` }} aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"></div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* Top Absentees */}
                <div className="col-12 col-lg-4">
                    <div className="card h-100 p-4 border shadow-sm bg-white rounded-3 d-flex flex-column">
                        <div className="d-flex justify-content-between align-items-center mb-4">
                            <h3 className="small fw-bold text-uppercase text-secondary tracking-widest mb-0">Top Absentees</h3>
                            <span className="badge bg-danger text-white" style={{ fontSize: '10px' }}>CRITICAL</span>
                        </div>
                        <div className="d-flex flex-column gap-2 flex-grow-1">
                            {stats.topAbsent.length === 0 ? <p className="small text-muted text-center my-4 fw-semibold">No absentees logged.</p> : stats.topAbsent.map((e, idx) => (
                                <div key={idx} className="d-flex align-items-center justify-content-between p-3 bg-white border rounded shadow-sm">
                                    <div className="d-flex align-items-center gap-3">
                                        <div className="rounded-circle bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center fw-bold" style={{ width: '36px', height: '36px' }}>{e.name.charAt(0)}</div>
                                        <div className="d-flex flex-column">
                                            <span className="small fw-bold text-dark text-truncate" style={{ maxWidth: '120px' }}>{e.name}</span>
                                            <span className="text-secondary" style={{ fontSize: '10px' }}>{e.dept}</span>
                                        </div>
                                    </div>
                                    <div className="text-end d-flex flex-column align-items-end">
                                        <span className="small fw-bold text-danger">{e.absent} Days</span>
                                        <span className="text-secondary" style={{ fontSize: '10px' }}>Loss: ₹{((parseFloat(e.absent)||0) * (parseFloat(e.perDaySalary)||0)).toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Highest OT Logged */}
                <div className="col-12 col-lg-4">
                    <div className="card h-100 p-4 border shadow-sm bg-white rounded-3 d-flex flex-column">
                        <div className="d-flex justify-content-between align-items-center mb-4">
                            <h3 className="small fw-bold text-uppercase text-secondary tracking-widest mb-0">Highest OT Logged</h3>
                            <span className="badge bg-brand-100 text-brand-700" style={{ fontSize: '10px' }}>REVIEW</span>
                        </div>
                        <div className="d-flex flex-column gap-2 flex-grow-1">
                            {stats.topOT.length === 0 ? <p className="small text-muted text-center my-4 fw-semibold">No overtime logged.</p> : stats.topOT.map((e, idx) => (
                                <div key={idx} className="d-flex align-items-center justify-content-between p-3 bg-white border rounded shadow-sm">
                                    <div className="d-flex align-items-center gap-3">
                                        <div className="rounded-circle bg-brand-50 text-brand-600 d-flex align-items-center justify-content-center fw-bold" style={{ width: '36px', height: '36px' }}>{e.name.charAt(0)}</div>
                                        <div className="d-flex flex-column">
                                            <span className="small fw-bold text-dark text-truncate" style={{ maxWidth: '120px' }}>{e.name}</span>
                                            <span className="text-secondary" style={{ fontSize: '10px' }}>{e.dept}</span>
                                        </div>
                                    </div>
                                    <div className="text-end d-flex flex-column align-items-end">
                                        <span className="small fw-bold text-brand-600">{e.otHrs} Hrs</span>
                                        <span className="text-secondary" style={{ fontSize: '10px' }}>Cost: ₹{(parseFloat(e.dailyOtSalary)||0).toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* NEW JOINERS SECTION */}
            <div className="card p-4 border shadow-sm bg-white rounded-3 mt-2">
                <div className="d-flex align-items-center justify-content-between mb-4">
                    <h3 className="h6 fw-bold text-dark text-uppercase mb-0 d-flex align-items-center gap-2">
                        <Icon path="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" className="text-brand-500"/> 
                        New Joiners 
                        <span className="badge bg-brand-100 text-brand-700 rounded-pill" style={{ fontSize: '11px' }}>{stats.newJoiners.length}</span>
                    </h3>
                </div>
                {stats.newJoiners.length === 0 ? (
                    <div className="text-center py-4 text-muted bg-light rounded border border-dashed">No new joiners logged with a joining date.</div>
                ) : (
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead className="table-light text-secondary text-uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>
                                <tr>
                                    <th className="p-3 fw-bold">Employee Name</th>
                                    <th className="p-3 fw-bold">Department</th>
                                    <th className="p-3 fw-bold">Joining Date</th>
                                    <th className="p-3 fw-bold">Basic Salary</th>
                                </tr>
                            </thead>
                            <tbody className="text-dark" style={{ fontSize: '13px' }}>
                                {stats.newJoiners.map((nj, i) => (
                                    <tr key={i}>
                                        <td className="p-3 fw-bold text-dark">{nj.name}</td>
                                        <td className="p-3 text-secondary">{nj.dept}</td>
                                        <td className="p-3 fw-bold text-brand-600">{formatDate(nj.joiningDate)}</td>
                                        <td className="p-3 fw-bold text-dark">₹{(parseFloat(nj.basicSalary)||0).toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

const App = () => {
const [auth, setAuth] = useState(() => {
    const savedPwd = localStorage.getItem(PWD_KEY);
    return { isLocked: true, hasPassword: !!savedPwd, password: savedPwd ? atob(savedPwd) : "" };
});
const [passInput, setPassInput] = useState("");

// Multi-Month DB Architecture
const [activeMonthKey, setActiveMonthKey] = useState(() => localStorage.getItem(MONTH_KEY) || MONTHS[0].id);

// Directory Access Handle (Persistent Month-Wise Workspace)
const [dirHandle, setDirHandle] = useState(null);
const [isDirGranted, setIsDirGranted] = useState(false);

const [dbs, setDbs] = useState(() => {
    const loaded = {};
    MONTHS.forEach(m => {
        const saved = localStorage.getItem(m.dbKey);
        if (saved) { 
            try { loaded[m.id] = JSON.parse(saved).map(e => compute(e, m)); } 
            catch(e){ loaded[m.id] = []; } 
        } else {
            loaded[m.id] = [];
        }
    });
    return loaded;
});

const activeConf = useMemo(() => MONTHS.find(m => m.id === activeMonthKey), [activeMonthKey]);
const db = useMemo(() => dbs[activeMonthKey] || [], [dbs, activeMonthKey]);

// Attempt to restore persistent system directory link from IndexedDB on page load/refresh
useEffect(() => {
    const restoreDirectoryLink = async () => {
        try {
            const savedHandle = await loadHandleFromIDB();
            if (savedHandle) {
                setDirHandle(savedHandle);
                const currentStatus = await savedHandle.queryPermission({ mode: 'readwrite' });
                setIsDirGranted(currentStatus === 'granted');
            }
        } catch (err) {
            console.error("Directory Handle Restoration Error:", err);
        }
    };
    restoreDirectoryLink();
}, []);

// Effect hooks for persistence
useEffect(() => { localStorage.setItem(MONTH_KEY, activeMonthKey); }, [activeMonthKey]);
useEffect(() => { 
    MONTHS.forEach(m => {
        localStorage.setItem(m.dbKey, JSON.stringify(dbs[m.id]));
    });
    autoSyncToLocalDirectory(db);
}, [dbs]);

const setDb = useCallback((newDbOrFn) => {
    setDbs(prev => {
        const updated = typeof newDbOrFn === 'function' ? newDbOrFn(prev[activeMonthKey]) : newDbOrFn;
        return { ...prev, [activeMonthKey]: updated };
    });
}, [activeMonthKey]);

const [activeTab, setActiveTab] = useState("employees");
const [logDate, setLogDate] = useState(1);
const [selectedId, setSelectedId] = useState(null);
const [search, setSearch] = useState("");
const [focusDay, setFocusDay] = useState(null);
const [otModal, setOtModal] = useState({ show: false, day: null, val: "" });
const [commentModal, setCommentModal] = useState({ show: false, day: null, val: "" });
const [pdfModal, setPdfModal] = useState({ show: false, hideBasic: false }); 
const [timeModal, setTimeModal] = useState({ show: false, day: null, step: 'in', inVal: '', outVal: '', custom: '' });

const [pdfSigs, setPdfSigs] = useState(() => {
    const saved = localStorage.getItem(SIG_KEY);
    if (saved) return JSON.parse(saved);
    return { prep: "MR. ARPIT MISHRA", rech: "MR. AMIT SINGH", ver: "MR. KUNAL CHANCHAL", app: "MR. MS SIR" };
});

const [toast, setToast] = useState(null);
const fileRef = useRef(null);
const otInputRef = useRef(null);
const commentInputRef = useRef(null);

useEffect(() => { localStorage.setItem(SIG_KEY, JSON.stringify(pdfSigs)); }, [pdfSigs]); 
useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);
useEffect(() => { if (otModal.show && otInputRef.current) { otInputRef.current.focus(); otInputRef.current.select(); } }, [otModal.show]);
useEffect(() => { if (commentModal.show && commentInputRef.current) { commentInputRef.current.focus(); } }, [commentModal.show]);

useEffect(() => {
    const handleGlobalEsc = (e) => {
        if (e.key === 'Escape') {
            if (timeModal.show) { setTimeModal(prev => ({...prev, show: false})); return; }
            if (otModal.show) { setOtModal(prev => ({...prev, show: false})); return; }
            if (commentModal.show) { setCommentModal(prev => ({...prev, show: false})); return; }
            if (pdfModal.show) { setPdfModal(prev => ({...prev, show: false})); return; }
            if (activeTab !== 'employees') { setActiveTab('employees'); return; }
        }
    };
    window.addEventListener('keydown', handleGlobalEsc);
    return () => window.removeEventListener('keydown', handleGlobalEsc);
}, [otModal.show, commentModal.show, pdfModal.show, timeModal.show, activeTab]);

const notify = (msg, type="success") => setToast({ msg, type });

const handleLogin = (e) => {
    e.preventDefault();
    if (!auth.hasPassword) {
        if(!passInput) return notify("Password cannot be empty!", "error");
        localStorage.setItem(PWD_KEY, btoa(passInput));
        setAuth({ isLocked: false, hasPassword: true, password: passInput });
        setPassInput("");
        notify("Master password created successfully!", "success");
    } else {
        if (passInput === auth.password) {
            setAuth({ ...auth, isLocked: false });
            setPassInput("");
            notify("Unlocked successfully!", "success");
        } else {
            notify("Incorrect Password!", "error");
        }
    }
};

const verifyPermission = async (handle, readWrite = true) => {
    const opts = {};
    if (readWrite) opts.mode = 'readwrite';
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
};

// Selection tool for Local Directory Link
const selectLocalDirectory = async () => {
    try {
        if (!window.showDirectoryPicker) {
            return notify("Your browser does not support Local Folder Sync. Please use Google Chrome or Microsoft Edge.", "error");
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        setDirHandle(handle);
        await saveHandleToIDB(handle);
        setIsDirGranted(true);
        notify("Workspace synced permanently!", "success");
    } catch (err) {
        console.error(err);
        notify("Directory selection cancelled or failed.", "error");
    }
};

const triggerLocalUnlock = async () => {
    if (!dirHandle) return;
    try {
        const granted = await verifyPermission(dirHandle, true);
        setIsDirGranted(granted);
        if (granted) {
            notify("Folder Workspace Unlocked & Active!", "success");
            autoSyncToLocalDirectory(db);
        }
    } catch (err) {
        console.error(err);
        notify("Folder unlock request failed.", "error");
    }
};

const autoSyncToLocalDirectory = async (currentDb) => {
    if (!dirHandle || !isDirGranted || !currentDb || currentDb.length === 0) return;
    try {
        const folderName = activeConf.id; 
        const fileName = `arise_attendance_data.json`;
        
        const subfolder = await dirHandle.getDirectoryHandle(folderName, { create: true });
        const file = await subfolder.getFileHandle(fileName, { create: true });
        const writable = await file.createWritable();
        
        const cleanState = currentDb.map(e => {
            const raw = { ...e };
            delete raw.autoWoDays; 
            return raw;
        });
        
        await writable.write(JSON.stringify(cleanState, null, 2));
        await writable.close();
    } catch (err) {
        console.warn("Real-time auto-sync skipped (Workspace Locked):", err);
    }
};

const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
        complete: (res) => {
            try {
                const data = res.data;
                const parsed = [];
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    if (!row || row.length < 5) continue;
                    const n = String(row[1] || "").trim();
                    if (n && !["employee name", "department", "prepared by", "total due", "recheck by"].some(x => n.toLowerCase().includes(x))) {
                        const em = { id: Math.random().toString(36).substr(2, 9), srNo: String(row[0]||"").trim(), name: n, dept: String(row[2]||"").trim(), code: String(row[3]||"").trim() || `C-${i}`, type: String(row[4]||"").trim(), basicSalary: parseFloat(row[67]) || 0, previousBalance: parseFloat(row[80]) || 0, advance: parseFloat(row[82]) || 0, joiningDate: "" };
                        for (let d = 1; d <= activeConf.days; d++) { 
                            em[`d${d}`] = String(row[5+(d-1)*2]||"").trim(); 
                            em[`ot${d}`] = String(row[6+(d-1)*2]||"").trim(); 
                            em[`c${d}`] = "";
                            em[`in${d}`] = "";
                            em[`out${d}`] = "";
                        }
                        parsed.push(compute(em, activeConf));
                    }
                }
                if (parsed.length > 0) { setDb(parsed); notify(`Imported ${parsed.length} records into ${activeConf.label}`); } else notify("No valid data", "error");
            } catch (err) { notify("Parse error", "error"); }
            if (fileRef.current) fileRef.current.value = "";
        }
    });
};

const handleExportExcel = () => {
    if (db.length === 0) { notify("No data to export", "error"); return; }
    try {
        const wb = XLSX.utils.book_new();
        const CLR_YELLOW = { rgb: "FFD966" };
        const CLR_BLUE = { rgb: "8EA9DB" };
        const CLR_LIGHTGRAY = { rgb: "F2F2F2" };
        const BORDER_ALL = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };

        const cell = (val, bg, bold, align = "center", isFormula = false) => {
            const style = { border: BORDER_ALL, alignment: { horizontal: align, vertical: "center" } };
            if (bg) style.fill = { fgColor: bg };
            if (bold) style.font = { bold: true };
            if (isFormula) return { f: val, s: style };
            return { v: val === undefined || val === null ? "" : val, t: typeof val === "number" ? "n" : "s", s: style };
        };

        const aoa = [];
        aoa.push([ { v: "Arise Construction Equipments", t: "s", s: { font: { bold: true, sz: 14 } } } ]);
        aoa.push([ { v: `Attendance Sheet - ${activeConf.label.toUpperCase()}`, t: "s", s: { font: { bold: true, sz: 12 } } } ]);

        const head1 = [
            cell("Sr. No.", CLR_LIGHTGRAY, true), cell("Employee Name", CLR_LIGHTGRAY, true, "left"),
            cell("DEPARTMENT", CLR_LIGHTGRAY, true), cell("CODE", CLR_BLUE, true), cell("TYPE", CLR_LIGHTGRAY, true)
        ];

        for (let i = 1; i <= activeConf.days; i++) {
            const isWk = activeConf.weekends.includes(i);
            head1.push(cell(String(i).padStart(2, '0'), isWk ? CLR_YELLOW : CLR_LIGHTGRAY, true));
            head1.push(cell("", isWk ? CLR_YELLOW : CLR_LIGHTGRAY, true)); 
        }

        const pHeaders = ["Basic Salary", "Present", "w/O", "T", "Working Days", "Absent Days", "O.T. HRS", "Total Working Days", "Per Day Salary", "Per HRS Salary", "Monthly Salary", "Daily OT Salary", "Actual Monthly Salary", "Previous Balance", "Salary After Previous", "Advance", "Salary To Be Paid", "Actual Salary Paid", "Balance Status"];
        pHeaders.forEach(ph => head1.push(cell(ph, ph.includes("Actual") || ph.includes("Salary To Be Paid") ? CLR_YELLOW : CLR_LIGHTGRAY, true)));
        aoa.push(head1);

        const head2 = [
            cell("", CLR_LIGHTGRAY, true), cell("", CLR_LIGHTGRAY, true), cell("", CLR_LIGHTGRAY, true), cell("", CLR_BLUE, true), cell("", CLR_LIGHTGRAY, true)
        ];
        
        for (let i = 1; i <= activeConf.days; i++) {
            const isWk = activeConf.weekends.includes(i);
            head2.push(cell(DAY_NAMES[(activeConf.startOffset + i - 1) % 7], isWk ? CLR_YELLOW : CLR_LIGHTGRAY, true));
            head2.push(cell("OT", isWk ? CLR_YELLOW : CLR_LIGHTGRAY, true)); 
        }
        pHeaders.forEach(ph => head2.push(cell("", ph.includes("Actual") || ph.includes("Salary To Be Paid") ? CLR_YELLOW : CLR_LIGHTGRAY, true)));
        aoa.push(head2);

        const getColName = (c) => {
            let colName = String.fromCharCode(65 + (c % 26));
            if (c >= 26) colName = String.fromCharCode(64 + Math.floor(c/26)) + colName;
            return colName;
        };
        const sunCols = activeConf.weekends.map(d => getColName(5 + (d-1)*2)); 

        const baseIdx = 5 + activeConf.days * 2;
        const colBasic = getColName(baseIdx);
        const colP = getColName(baseIdx + 1);
        const colWO = getColName(baseIdx + 2);
        const colT = getColName(baseIdx + 3);
        const colWkDays = getColName(baseIdx + 4);
        const colAbs = getColName(baseIdx + 5);
        const colOT = getColName(baseIdx + 6);
        const colTotDays = getColName(baseIdx + 7);
        const colPerDay = getColName(baseIdx + 8);
        const colPerHr = getColName(baseIdx + 9);
        const colMonSal = getColName(baseIdx + 10);
        const colOtSal = getColName(baseIdx + 11);
        const colActSal = getColName(baseIdx + 12);
        const colPrev = getColName(baseIdx + 13);
        const colSalPrev = getColName(baseIdx + 14);
        const colAdv = getColName(baseIdx + 15);
        const colSalPay = getColName(baseIdx + 16);

        const endAttColName = getColName(4 + activeConf.days * 2);

        db.forEach((emp, index) => {
            const R = index + 5; 
            const row = [
                cell(emp.srNo || index + 1, null, true), cell(emp.name, null, true, "left"), cell(emp.dept, null, false), cell(emp.code, null, true), cell(emp.type, null, false)
            ];

            for (let i = 1; i <= activeConf.days; i++) {
                const isWk = activeConf.weekends.includes(i);
                const bg = isWk ? CLR_YELLOW : null;
                const manual = String(emp[`d${i}`] || "").trim().toUpperCase();
                const aVal = manual || (emp.autoWoDays?.[i] || "");
                row.push(cell(aVal, bg, false));
                const otRaw = String(emp[`ot${i}`] || "").trim();
                const otVal = (otRaw !== "" && !isNaN(otRaw)) ? parseFloat(otRaw) : "";
                const otC = cell(otVal, bg, false);
                if (otVal !== "" && otVal < 0) otC.s.font = { color: { rgb: "FF0000" }, bold: true };
                else if (otVal !== "" && otVal > 0) otC.s.font = { color: { rgb: "0000FF" }, bold: true };
                row.push(otC);
            }

            const attRange = `F${R}:${endAttColName}${R}`;
            const extraWoFormula = sunCols.length ? sunCols.map(col => `IF(OR(${col}${R}="P", ${col}${R}="P?", ${col}${R}="H", ${col}${R}="0.5", ${col}${R}="T", ${col}${R}="L"), 1, 0)`).join("+") : "0";

            row.push(
                cell(parseFloat(emp.basicSalary) || 0, null, true),
                cell(`COUNTIF(${attRange},"P")+COUNTIF(${attRange},"P~?")+COUNTIF(${attRange},"H")*0.5+COUNTIF(${attRange},"0.5")*0.5+COUNTIF(${attRange},"L")`, null, true, "center", true),
                cell(`COUNTIF(${attRange},"W/O") + IF(UPPER(E${R})="E", ${extraWoFormula}, 0)`, null, false, "center", true),
                cell(`COUNTIF(${attRange},"T")`, null, false, "center", true),
                cell(`${colP}${R}+${colWO}${R}+${colT}${R}`, null, true, "center", true),
                cell(`COUNTIF(${attRange},"A")`, null, true, "center", true),
                cell(`SUMIF(F$4:${endAttColName}$4,"OT",F${R}:${endAttColName}${R})`, null, true, "center", true),
                cell(activeConf.days, null, false),
                cell(`IF(${colTotDays}${R}>0, ${colBasic}${R}/${colTotDays}${R}, 0)`, null, false, "center", true),
                cell(`IF(${colPerDay}${R}>0, ${colPerDay}${R}/8.5, 0)`, null, false, "center", true),
                cell(`ROUND(${colWkDays}${R}*${colPerDay}${R}, 0)`, null, false, "center", true),
                cell(`ROUND(${colOT}${R}*${colPerHr}${R}, 0)`, null, false, "center", true),
                cell(`ROUND(${colMonSal}${R}+${colOtSal}${R}, 0)`, CLR_YELLOW, true, "center", true),
                cell(parseFloat(emp.previousBalance) || 0, null, false),
                cell(`ROUND(${colActSal}${R}+${colPrev}${R}, 0)`, null, false, "center", true),
                cell(parseFloat(emp.advance) || 0, null, false),
                cell(`ROUND(${colSalPrev}${R}-${colAdv}${R}, 0)`, CLR_YELLOW, true, "center", true),
                cell("", null, false), cell("", null, false)
            );
            aoa.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const merges = [];
        for (let i = 0; i < 5; i++) merges.push({ s: { r: 2, c: i }, e: { r: 3, c: i } });
        let col = 5;
        for (let i = 1; i <= activeConf.days; i++) { merges.push({ s: { r: 2, c: col }, e: { r: 2, c: col + 1 } }); col += 2; }
        for (let i = col; i < col + pHeaders.length; i++) merges.push({ s: { r: 2, c: i }, e: { r: 3, c: i } });
        ws['!merges'] = merges;
        
        const cols = [{ wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 6 }];
        for (let i = 0; i < activeConf.days; i++) { cols.push({ wch: 4.5 }); cols.push({ wch: 4.5 }); } 
        pHeaders.forEach(() => cols.push({ wch: 12 }));
        ws['!cols'] = cols;

        XLSX.utils.book_append_sheet(wb, ws, activeConf.short);
        XLSX.writeFile(wb, `Arise_Attendance_${activeConf.short}.xlsx`);
        notify("Formula-based Excel Exported!", "success");
    } catch(err) { notify("Failed to export Excel", "error"); console.error(err); }
};

const handleExportInOutExcel = () => {
    if (db.length === 0) { notify("No data to export", "error"); return; }
    try {
        const wb = XLSX.utils.book_new();
        const aoa = [];

        const CLR_HEADER = { rgb: "203780" }; // Dark Blue
        const CLR_WHITE = { rgb: "FFFFFF" };
        const CLR_WEEKEND = { rgb: "D9EAD3" }; // Light Green

        const BORDER_TOP = { top: { style: "thin", color: { rgb: "000000" } } };
        const BORDER_BOTTOM = { bottom: { style: "thin", color: { rgb: "000000" } } };
        const BORDER_LEFT = { left: { style: "thin", color: { rgb: "000000" } } };
        const BORDER_RIGHT = { right: { style: "thin", color: { rgb: "000000" } } };
        const BORDER_DOTTED_BOTTOM = { bottom: { style: "dotted", color: { rgb: "888888" } } };
        const BORDER_DOTTED_TOP = { top: { style: "dotted", color: { rgb: "888888" } } };

        const BORDER_FULL = { ...BORDER_TOP, ...BORDER_BOTTOM, ...BORDER_LEFT, ...BORDER_RIGHT };
        const BORDER_IN_ROW = { ...BORDER_TOP, ...BORDER_LEFT, ...BORDER_RIGHT, ...BORDER_DOTTED_BOTTOM };
        const BORDER_OUT_ROW = { ...BORDER_LEFT, ...BORDER_RIGHT, ...BORDER_BOTTOM, ...BORDER_DOTTED_TOP };

        const cell = (val, bg, bold, align = "center", txtColor = null, customBorder = null) => {
            const style = { alignment: { horizontal: align, vertical: "center", wrapText: true } };
            style.border = customBorder || BORDER_FULL;
            if (bg) style.fill = { fgColor: bg };
            if (bold || txtColor) {
                style.font = {};
                if (bold) style.font.bold = true;
                if (txtColor) style.font.color = txtColor;
            }
            return { v: val === undefined || val === null ? "" : val, t: "s", s: style };
        };

        const totalCols = 2 + activeConf.days; // Sr, Name, Days 1..N
        const merges = [];

        const row1 = [ { v: "ARISE CONSTRUCTION EQUIPMENT", t: "s", s: { alignment: { horizontal: "center", vertical: "center" }, font: { bold: true, sz: 16, color: CLR_WHITE }, fill: { fgColor: CLR_HEADER } } } ];
        for(let i=1; i<totalCols; i++) row1.push("");
        aoa.push(row1);
        merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });

        const row2 = [ { v: `MONTHLY ATTENDANCE REGISTER | ${activeConf.label.toUpperCase()}`, t: "s", s: { alignment: { horizontal: "center", vertical: "center" }, font: { sz: 10, color: CLR_WHITE }, fill: { fgColor: CLR_HEADER } } } ];
        for(let i=1; i<totalCols; i++) row2.push("");
        aoa.push(row2);
        merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } });

        const row3 = [
            cell("#", CLR_HEADER, true, "center", CLR_WHITE),
            cell("Employee Name", CLR_HEADER, true, "center", CLR_WHITE)
        ];
        for (let i = 1; i <= activeConf.days; i++) {
            const isWk = activeConf.weekends.includes(i);
            const dayName = DAY_NAMES[(activeConf.startOffset + i - 1) % 7].substring(0, 2);
            row3.push(cell(`${i}\n${dayName}`, isWk ? CLR_WEEKEND : CLR_HEADER, true, "center", isWk ? {rgb:"000000"} : CLR_WHITE));
        }
        aoa.push(row3);

        const row4 = [
            cell("", CLR_HEADER, true, "center", CLR_WHITE),
            cell("", CLR_HEADER, true, "center", CLR_WHITE)
        ];
        for (let i = 1; i <= activeConf.days; i++) {
            const isWk = activeConf.weekends.includes(i);
            row4.push(cell("IN / OUT", isWk ? CLR_WEEKEND : CLR_HEADER, false, "center", isWk ? {rgb:"000000"} : CLR_WHITE));
        }
        aoa.push(row4);
        
        merges.push({ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } });
        merges.push({ s: { r: 2, c: 1 }, e: { r: 3, c: 1 } });

        db.forEach((emp, index) => {
            const rIn = [], rOut = [];
            const rBase = aoa.length;
            
            rIn.push(cell(index + 1, null, true, "center", null, BORDER_IN_ROW));
            rIn.push(cell(emp.name, null, true, "left", null, BORDER_IN_ROW));
            rOut.push(cell("", null, false, "center", null, BORDER_OUT_ROW));
            rOut.push(cell("", null, false, "left", null, BORDER_OUT_ROW));

            for (let i = 1; i <= activeConf.days; i++) {
                const isWk = activeConf.weekends.includes(i);
                const bg = isWk ? CLR_WEEKEND : null;
                
                const inTime = emp[`in${i}`] || "";
                const outTime = emp[`out${i}`] || "";
                
                let inDisplay = inTime;
                let outDisplay = outTime;
                
                if (!inTime && !outTime) {
                    const status = String(emp[`d${i}`] || "").trim().toUpperCase();
                    if (status && status !== 'P') {
                        inDisplay = status; 
                    }
                }

                rIn.push(cell(inDisplay, bg, false, "center", null, BORDER_IN_ROW));
                rOut.push(cell(outDisplay, bg, false, "center", null, BORDER_OUT_ROW));
            }

            aoa.push(rIn);
            aoa.push(rOut);

            merges.push({ s: { r: rBase, c: 0 }, e: { r: rBase + 1, c: 0 } });
            merges.push({ s: { r: rBase, c: 1 }, e: { r: rBase + 1, c: 1 } });
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!merges'] = merges;
        
        const cols = [{ wch: 5 }, { wch: 25 }];
        for (let i = 0; i < activeConf.days; i++) cols.push({ wch: 9 });
        ws['!cols'] = cols;
        
        const rows = [{ hpt: 35 }, { hpt: 20 }, { hpt: 30 }, { hpt: 15 }];
        for(let i=0; i<db.length; i++){
            rows.push({ hpt: 18 }); 
            rows.push({ hpt: 18 }); 
        }
        ws['!rows'] = rows;

        XLSX.utils.book_append_sheet(wb, ws, "IN_OUT_Log");
        XLSX.writeFile(wb, `Arise_IN_OUT_Check_${activeConf.short}.xlsx`);
        notify("IN/OUT Time Excel Exported!", "success");
    } catch(err) { notify("Failed to export Excel", "error"); console.error(err); }
};

const executePDFExport = () => {  
    const hideBasic = pdfModal.hideBasic;
    setPdfModal({ ...pdfModal, show: false });

    if (db.length === 0) { notify("No data to export", "error"); return; }
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        let tBasic = 0, tDays = 0, tAdv = 0, tNet = 0;
        let tP = 0, tL = 0, tWO = 0, tH = 0, tPMiss = 0, tT = 0, tOT = 0;
        
        const deptStats = {};
        const newJoiners = [];

        db.forEach(e => {
            const basic = parseFloat(e.basicSalary) || 0;
            const days = parseFloat(e.workingDays) || 0;
            const adv = parseFloat(e.advance) || 0;
            const net = parseFloat(e.salaryToBePaid) || 0; 

            tBasic += basic;
            tDays += days;
            tAdv += adv;
            tNet += net;
            tP += (parseFloat(e.pOnly) || 0); 
            tL += (parseFloat(e.leave) || 0); 
            tWO += (parseFloat(e.wo) || 0);
            tH += (parseFloat(e.half) || 0);
            tPMiss += (parseFloat(e.pMiss) || 0);
            tT += (parseFloat(e.tour) || 0);
            tOT += (parseFloat(e.otHrs) || 0);

            const dName = e.dept || 'Uncategorized';
            if (!deptStats[dName]) deptStats[dName] = { count: 0, cost: 0 };
            deptStats[dName].count += 1;
            deptStats[dName].cost += net;

            if(e.joiningDate && e.joiningDate.trim() !== "") {
                newJoiners.push(e);
            }
        });

        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.setTextColor(15, 61, 129); 
        doc.text("ARISE CONSTRUCTION EQUIPMENTS", 105, 15, { align: 'center' });
        
        doc.setFontSize(11);
        doc.setTextColor(60, 60, 60);
        doc.text(`Payroll & Attendance Verification Dashboard - ${activeConf.label.toUpperCase()}`, 105, 22, { align: 'center' });

        doc.setFillColor(235, 235, 235);
        if (hideBasic) {
            doc.rect(35.5, 28, 43, 16, 'F'); doc.setFillColor(230, 240, 255); doc.rect(83.5, 28, 43, 16, 'F'); doc.setFillColor(235, 235, 235); doc.rect(131.5, 28, 43, 16, 'F');
            doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80, 80, 80);
            doc.text("Total Working Days", 57, 34, { align: 'center' }); doc.text("Total Advance", 105, 34, { align: 'center' }); doc.text("Net Salary To Be Paid", 153, 34, { align: 'center' });
            doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(15, 61, 129); doc.text(`${tDays}`, 57, 41, { align: 'center' }); doc.setTextColor(180, 0, 0); doc.text(`Rs. ${Math.round(tAdv).toLocaleString()}`, 105, 41, { align: 'center' }); doc.setTextColor(0, 128, 0); doc.text(`Rs. ${Math.round(tNet).toLocaleString()}`, 153, 41, { align: 'center' });
        } else {
            doc.rect(14, 28, 43, 16, 'F'); doc.setFillColor(230, 240, 255); doc.rect(60, 28, 43, 16, 'F'); doc.setFillColor(235, 235, 235); doc.rect(106, 28, 43, 16, 'F'); doc.rect(152, 28, 43, 16, 'F');
            doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80, 80, 80);
            doc.text("Total Basic Salary", 35.5, 34, { align: 'center' }); doc.text("Total Working Days", 81.5, 34, { align: 'center' }); doc.text("Total Advance", 127.5, 34, { align: 'center' }); doc.text("Net Salary To Be Paid", 173.5, 34, { align: 'center' });
            doc.setFont("helvetica", "bold"); doc.setFontSize(11);
            doc.setTextColor(15, 61, 129); doc.text(`Rs. ${Math.round(tBasic).toLocaleString()}`, 35.5, 41, { align: 'center' }); doc.text(`${tDays}`, 81.5, 41, { align: 'center' }); doc.setTextColor(180, 0, 0); doc.text(`Rs. ${Math.round(tAdv).toLocaleString()}`, 127.5, 41, { align: 'center' }); doc.setTextColor(0, 128, 0); doc.text(`Rs. ${Math.round(tNet).toLocaleString()}`, 173.5, 41, { align: 'center' });
        }

        const head = [['S.No', 'Employee Name', 'Department']];
        if (!hideBasic) head[0].push('Basic\nSalary');
        head[0].push('P', 'L', 'W/O', 'H', 'P?', 'T', 'Days', 'Hrs\n(OT)', 'Advance', 'Salary To Pay');

        const tableData = db.map((e, index) => {
            const netPay = parseFloat(e.salaryToBePaid) || 0; 
            const row = [ index + 1, e.name, e.dept || '-' ];
            if (!hideBasic) row.push(e.basicSalary ? `Rs. ${Math.round(parseFloat(e.basicSalary)).toLocaleString()}` : '-');
            row.push(e.pOnly || '-', e.leave || '-', e.wo || '-', e.half || '-', e.pMiss || '-', e.tour || '-', e.workingDays || '-', e.otHrs || '-', e.advance ? `Rs. ${Math.round(parseFloat(e.advance)).toLocaleString()}` : '-', netPay ? `Rs. ${Math.round(netPay).toLocaleString()}` : '0');
            return row;
        });

        const grandTotalRow = ["", "GRAND TOTAL", ""];
        if (!hideBasic) grandTotalRow.push(`Rs. ${Math.round(tBasic).toLocaleString()}`);
        grandTotalRow.push(tP || '-', tL || '-', tWO || '-', tH || '-', tPMiss || '-', tT || '-', tDays, tOT || '-', `Rs. ${Math.round(tAdv).toLocaleString()}`, `Rs. ${Math.round(tNet).toLocaleString()}`);
        tableData.push(grandTotalRow);

        const advColIndex = hideBasic ? 11 : 12;
        const netColIndex = hideBasic ? 12 : 13;

        doc.autoTable({
            startY: 48, head: head, body: tableData, theme: 'grid', headStyles: { fillColor: [15, 61, 129], textColor: [255, 255, 255], halign: 'center', valign: 'middle', fontSize: 8 },
            styles: { fontSize: 7.5, cellPadding: 1.5, halign: 'center', valign: 'middle' }, columnStyles: { 1: { halign: 'left' }, 2: { halign: 'left' } },
            didParseCell: function (data) {
                const rowIdx = data.row.index; const isLastRow = rowIdx === tableData.length - 1;
                if (isLastRow && data.row.section === 'body') { data.cell.styles.fillColor = [225, 225, 225]; data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = [0, 0, 0]; if (data.column.index === advColIndex) data.cell.styles.textColor = [180, 0, 0]; if (data.column.index === netColIndex) data.cell.styles.textColor = [0, 128, 0]; } 
                else if (data.row.section === 'body') { if (data.column.index === advColIndex && data.cell.raw !== '-') data.cell.styles.textColor = [180, 0, 0]; if (data.column.index === netColIndex && data.cell.raw !== '-') { data.cell.styles.textColor = [0, 128, 0]; data.cell.styles.fontStyle = 'bold'; } }
            }
        });

        let currentY = doc.lastAutoTable.finalY + 10;
        const sortedDepts = Object.keys(deptStats).sort((a,b) => deptStats[b].cost - deptStats[a].cost);
        sortedDepts.push('__GRAND_TOTAL__');
        deptStats['__GRAND_TOTAL__'] = { count: db.length, cost: tNet };

        const boxW = 58; const boxH = 12; const gapX = 4; const gapY = 4; const cols = 3; const rowsUsed = Math.ceil(sortedDepts.length / cols);
        if (currentY + (rowsUsed * (boxH + gapY)) + 20 > 280) { doc.addPage(); currentY = 20; }

        doc.setFontSize(11); doc.setTextColor(15, 61, 129); doc.setFont("helvetica", "bold"); doc.text("Department Salary Summary", 14, currentY);
        currentY += 6;

        sortedDepts.forEach((d, i) => {
            const isTotal = d === '__GRAND_TOTAL__'; const x = 14 + (i % cols) * (boxW + gapX); const y = currentY + Math.floor(i / cols) * (boxH + gapY);
            const count = deptStats[d].count; const cost = deptStats[d].cost; const pct = tNet > 0 ? ((cost / tNet) * 100).toFixed(1) : 0; const dName = isTotal ? "GRAND TOTAL" : (d.length > 16 ? d.substring(0, 16) + '...' : d);
            if (isTotal) { doc.setFillColor(15, 61, 129); doc.setDrawColor(15, 61, 129); } else { doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); }
            doc.rect(x, y, boxW, boxH, 'FD'); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(isTotal ? 255 : 40); doc.text(dName.toUpperCase(), x + 3, y + 5);
            doc.setFont("helvetica", "normal"); doc.setTextColor(isTotal ? 200 : 100); doc.text(`${count} Emp`, x + boxW - 3, y + 5, { align: 'right' });
            doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(isTotal ? 255 : 21, isTotal ? 255 : 128, isTotal ? 255 : 61); doc.text(`Rs. ${Math.round(cost).toLocaleString()}`, x + 3, y + 9.5);
            doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(isTotal ? 255 : 15, isTotal ? 255 : 61, isTotal ? 255 : 129); doc.text(`${pct}%`, x + boxW - 3, y + 9.5, { align: 'right' });
        });

        currentY += rowsUsed * (boxH + gapY) + 5;
        if (newJoiners.length > 0) {
            if (currentY + 30 > 280) { doc.addPage(); currentY = 20; }
            doc.setFontSize(11); doc.setTextColor(15, 61, 129); doc.setFont("helvetica", "bold"); doc.text("New Joiners Report", 14, currentY);
            const njBody = newJoiners.map((nj, i) => [ i + 1, nj.name, nj.dept || '-', formatDate(nj.joiningDate), `Rs. ${Math.round(parseFloat(nj.basicSalary)||0).toLocaleString()}` ]);
            doc.autoTable({ startY: currentY + 4, head: [['S.No', 'Employee Name', 'Department', 'Joining Date', 'Basic Salary']], body: njBody, theme: 'grid', headStyles: { fillColor: [230, 240, 255], textColor: [15, 61, 129], fontStyle: 'bold', halign: 'center' }, styles: { fontSize: 8.5, halign: 'center', cellPadding: 2 }, columnStyles: { 1: { halign: 'left' }, 2: { halign: 'left' } } });
            currentY = doc.lastAutoTable.finalY + 10;
        }

        let finalY = currentY + 10; if (finalY > 270) { doc.addPage(); finalY = 30; }
        doc.setFontSize(8); doc.setTextColor(0, 0, 0); doc.setLineWidth(0.5); doc.setDrawColor(0, 0, 0);
        doc.line(14, finalY, 54, finalY); doc.text("Prepared By", 34, finalY + 5, { align: 'center', fontStyle: 'bold' }); doc.text(pdfSigs.prep, 34, finalY + 9, { align: 'center' });
        doc.line(60, finalY, 100, finalY); doc.text("Rechecked By", 80, finalY + 5, { align: 'center', fontStyle: 'bold' }); doc.text(pdfSigs.rech, 80, finalY + 9, { align: 'center' });
        doc.line(106, finalY, 150, finalY); doc.text("Verified By", 128, finalY + 5, { align: 'center', fontStyle: 'bold' }); doc.text(pdfSigs.ver, 128, finalY + 9, { align: 'center' });
        doc.line(156, finalY, 196, finalY); doc.text("Final Approval", 176, finalY + 5, { align: 'center', fontStyle: 'bold' }); doc.text(pdfSigs.app, 176, finalY + 9, { align: 'center' });

        doc.save(`Arise_Verification_${activeConf.short}.pdf`);
        notify("Verification PDF Exported successfully!", "success");

    } catch (err) {
        console.error(err); notify("Failed to export PDF. Ensure internet connection.", "error");
    }
};

const updateActive = (updates) => {
    if (!selectedId) return;
    setDb(prev => prev.map(e => e.id === selectedId ? compute({ ...e, ...updates }, activeConf) : e));
};

const updateAtt = useCallback((day, val) => {
    if (!selectedId) return;
    setDb(prev => prev.map(e => e.id === selectedId ? compute({ ...e, [`d${day}`]: val }, activeConf) : e));
}, [selectedId, activeConf, setDb]);

const updateOt = (day, val) => {
    setDb(prev => prev.map(e => e.id === selectedId ? compute({ ...e, [`ot${day}`]: val }, activeConf) : e));
    setOtModal({ show: false, day: null, val: "" });
    setTimeout(() => { document.getElementById(`day-${day}`)?.focus(); }, 10);
};

const updateComment = (day, val) => {
    setDb(prev => prev.map(e => e.id === selectedId ? compute({ ...e, [`c${day}`]: val }, activeConf) : e));
    setCommentModal({ show: false, day: null, val: "" });
    setTimeout(() => { document.getElementById(`day-${day}`)?.focus(); }, 10);
};

// Auto OT Injection via Time Select
const handleTimeSelect = (timeStr) => {
    if (timeModal.step === 'in') {
        setTimeModal(prev => ({ ...prev, step: 'out', inVal: timeStr, custom: '' }));
    } else {
        setDb(prev => prev.map(e => {
            if (e.id === selectedId) {
                let updatedEmp = { ...e, [`in${timeModal.day}`]: timeModal.inVal, [`out${timeModal.day}`]: timeStr };
                
                // Auto OT logic for E type
                if (String(updatedEmp.type || "").trim().toUpperCase() === "E") {
                    const autoOt = calculateAutoOT(timeModal.inVal, timeStr);
                    // If it evaluates to 0, we can clear it or leave it 0
                    updatedEmp[`ot${timeModal.day}`] = autoOt === 0 ? "" : autoOt;
                }
                
                return compute(updatedEmp, activeConf);
            }
            return e;
        }));
        setTimeModal({ show: false, day: null, step: 'in', inVal: '', outVal: '', custom: '' });
        setFocusDay(prev => Math.min(activeConf.days, prev + 1)); 
    }
};

const handleTimeCustomSave = () => {
    if (!timeModal.custom) return notify("Please select a time", "error");
    const formatted = formatTimeInput(timeModal.custom);
    handleTimeSelect(formatted);
};

const handleResetSystem = () => {
    if(confirm(`Are you absolutely sure you want to delete all data for ${activeConf.label}?`)) {
        setDb([]); setSelectedId(null); notify(`System reset for ${activeConf.label}.`, "success");
    }
};

const handleMigrateEmployees = () => {
    const otherMonthKey = MONTHS.find(m => m.id !== activeMonthKey).id;
    const oldDb = dbs[otherMonthKey];
    if (!oldDb || oldDb.length === 0) return notify("No employees exist in the other month yet.", "error");
    if (confirm(`Copy ${oldDb.length} employees from the other month into ${activeConf.label}? All their attendance logic will start fresh.`)) {
        const copied = oldDb.map(e => {
            const newE = { ...e };
            for(let i=1; i<=31; i++) { delete newE[`d${i}`]; delete newE[`ot${i}`]; delete newE[`c${i}`]; delete newE[`in${i}`]; delete newE[`out${i}`]; }
            for(let i=1; i<=activeConf.days; i++) { newE[`d${i}`] = ""; newE[`ot${i}`] = ""; newE[`c${i}`] = ""; newE[`in${i}`] = ""; newE[`out${i}`] = ""; }
            newE.previousBalance = 0; newE.advance = 0;
            return compute(newE, activeConf);
        });
        setDb(copied); notify("Workforce migrated successfully!", "success");
    }
};

useEffect(() => {
    const handleGlobalKey = (e) => {
        if (otModal.show || commentModal.show || pdfModal.show || timeModal.show) return;
        if (activeTab !== 'employees') return;
        if (!selectedId) return;
        
        const activeTag = document.activeElement.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

        if (['ArrowUp', 'ArrowDown'].includes(e.key) && !focusDay) {
            const curIdx = filtered.findIndex(x => x.id === selectedId);
            if (e.key === 'ArrowDown' && curIdx < filtered.length - 1) { setSelectedId(filtered[curIdx+1].id); e.preventDefault(); return; }
            if (e.key === 'ArrowUp' && curIdx > 0) { setSelectedId(filtered[curIdx-1].id); e.preventDefault(); return; }
        }

        if (!focusDay) return;
        if (e.key === 'ArrowRight') { setFocusDay(prev => Math.min(activeConf.days, prev + 1)); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { setFocusDay(prev => Math.max(1, prev - 1)); e.preventDefault(); }
        if (e.key === 'ArrowUp') { setFocusDay(prev => Math.max(1, prev - 7)); e.preventDefault(); }
        if (e.key === 'ArrowDown') { setFocusDay(prev => Math.min(activeConf.days, prev + 7)); e.preventDefault(); }

        const key = e.key.toLowerCase();
        
        if (key === 'p') { 
            updateAtt(focusDay, 'P'); 
            setTimeModal({ show: true, day: focusDay, step: 'in', inVal: '', outVal: '', custom: '' });
            e.preventDefault(); 
        }
        
        if (['a', 'h', 't', 'w', 'l'].includes(key) || e.key === 'Backspace' || e.key === 'Delete') { 
            let val = '';
            if (key === 'a') val = 'A';
            if (key === 'h') val = 'H';
            if (key === 't') val = 'T';
            if (key === 'w') val = 'W/O';
            if (key === 'l') val = 'L';
            setDb(prev => prev.map(em => em.id === selectedId ? compute({ ...em, [`d${focusDay}`]: val, [`in${focusDay}`]: '', [`out${focusDay}`]: '' }, activeConf) : em));
            setFocusDay(prev => Math.min(activeConf.days, prev + 1)); 
            e.preventDefault();
        }
        
        if (key === 'm') {
            updateAtt(focusDay, 'P?');
            const em = db.find(x => x.id === selectedId);
            setCommentModal({ show: true, day: focusDay, val: em ? em[`c${focusDay}`] || "" : "" });
            e.preventDefault();
        }
        
        if (key === 'o' || e.key === 'Enter') { 
            const em = db.find(x => x.id === selectedId);
            setOtModal({ show: true, day: focusDay, val: em ? em[`ot${focusDay}`] : "" }); 
            e.preventDefault(); 
        }
        if (key === 'c') {
            const em = db.find(x => x.id === selectedId);
            setCommentModal({ show: true, day: focusDay, val: em ? em[`c${focusDay}`] || "" : "" });
            e.preventDefault();
        }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
}, [selectedId, focusDay, db, otModal.show, commentModal.show, pdfModal.show, timeModal.show, updateAtt, activeTab, activeConf.days]);

useEffect(() => { if (focusDay && activeTab === 'employees') document.getElementById(`day-${focusDay}`)?.focus(); }, [focusDay, activeTab]);

const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return db.filter(e => e.name.toLowerCase().includes(s) || e.code.toLowerCase().includes(s));
}, [db, search]);

const activeEmp = useMemo(() => db.find(e => e.id === selectedId), [db, selectedId]);

const getAttColor = (val) => {
    if (val === 'P') return 'bg-success text-white border-success';
    if (val === 'P?') return 'bg-warning text-dark border-warning';
    if (val === 'A') return 'bg-danger text-white border-danger';
    if (val === '0.5' || val === 'H') return 'bg-warning text-dark border-warning';
    if (val === 'T') return 'bg-info text-white border-info';
    if (val === 'W/O') return 'bg-primary text-white border-primary';
    if (val === 'L') return 'bg-status-l text-white border-status-l'; 
    return 'bg-secondary bg-opacity-10 text-secondary border-light';
};

if (auth.isLocked) {
    return (
        <div className="d-flex vh-100 w-100 bg-dark align-items-center justify-content-center">
            <div className="card p-4 shadow-lg border-0 text-center bg-white" style={{ width: '360px', borderRadius: '16px' }}>
                <div className="rounded bg-brand-50 text-brand-600 d-flex align-items-center justify-content-center mx-auto mb-4 shadow-sm" style={{ width: '64px', height: '64px' }}>
                    <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" style={{ width: '32px', height: '32px' }} />
                </div>
                <h1 className="h3 fw-bold text-dark mb-2"><span className="text-brand-600">Arpit</span> HR OS</h1>
                <p className="small text-muted mb-4 fw-bold">{!auth.hasPassword ? "Create a master password." : "Enter your master password."}</p>
                <form onSubmit={handleLogin} className="w-100">
                    <input type="password" placeholder={!auth.hasPassword ? "New Password" : "Password"} value={passInput} onChange={e => setPassInput(e.target.value)} className="form-control form-control-lg text-center fw-bold text-dark bg-light mb-3" style={{ fontSize: '20px', letterSpacing: '4px' }} autoFocus />
                    <button type="submit" className="btn btn-primary w-100 fw-bold py-3 shadow-sm">{!auth.hasPassword ? "Set Password & Enter" : "Unlock System"}</button>
                </form>
            </div>
        </div>
    );
}

return (
<div className="d-flex vh-100 w-100 overflow-hidden text-dark bg-light">

    {/* Sidebar Section */}
    <div style={{ width: '320px', minWidth: '320px' }} className="bg-white border-end d-flex flex-column shadow-sm z-3 h-100 overflow-hidden flex-shrink-0">
        <div className="p-3 border-bottom bg-light d-flex flex-column gap-2 flex-shrink-0">
            <div className="d-flex justify-content-between align-items-center">
                <div>
                    <h1 className="h5 fw-bold tracking-tight text-dark mb-0"><span className="text-brand-600">Arise</span> HR</h1>
                    <p className="small text-muted mb-0 fw-semibold" style={{ fontSize: '11px' }}>{activeConf.label} Register</p>
                </div>
                <button onClick={() => { setAuth({...auth, isLocked: true}); notify("Locked securely.", "success"); }} className="btn btn-sm btn-light border d-flex align-items-center justify-content-center p-2 rounded" title="Lock System">
                    <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </button>
            </div>

            <div className="d-flex gap-1 mt-1 bg-secondary bg-opacity-10 p-1 rounded">
                {MONTHS.map(m => (
                    <button 
                        key={m.id} onClick={() => { setActiveMonthKey(m.id); setLogDate(1); setFocusDay(1); setSelectedId(null); }}
                        className={`btn btn-sm py-1 flex-grow-1 text-center fw-bold border-0`}
                        style={{
                            fontSize: '11px',
                            backgroundColor: activeMonthKey === m.id ? '#ffffff' : 'transparent',
                            color: activeMonthKey === m.id ? 'var(--brand-600)' : '#6c757d',
                            boxShadow: activeMonthKey === m.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                    >{m.label}</button>
                ))}
            </div>
            
            <div className="d-flex flex-column gap-1.5 mt-2">
                <div className="d-flex gap-2">
                    <input type="file" accept=".csv" className="d-none" ref={fileRef} onChange={handleImport} />
                    <button onClick={() => fileRef.current.click()} className="btn btn-sm btn-light border flex-grow-1 fw-bold text-secondary d-flex align-items-center justify-content-center gap-1 shadow-sm" style={{ fontSize: '10px' }}>
                        <Icon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/> Import
                    </button>
                    <button onClick={() => { const e = defaultEmp(activeConf); setDb([e, ...db]); setActiveTab('employees'); setSelectedId(e.id); }} className="btn btn-sm btn-primary px-3 d-flex align-items-center justify-content-center shadow-sm" title="Add New">
                        <Icon path="M12 4v16m8-8H4"/>
                    </button>
                </div>
                <div className="d-flex gap-1">
                    <button onClick={handleExportInOutExcel} className="btn btn-sm btn-light border text-primary flex-grow-1 fw-bold d-flex align-items-center justify-content-center gap-1" style={{ fontSize: '9px', backgroundColor: '#eef2ff' }} title="Download Special IN/OUT Time Sheet">
                        <Icon path="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" style={{ width: '12px', height: '12px' }}/> IN/OUT Log
                    </button>
                    <button onClick={handleExportExcel} className="btn btn-sm btn-light border text-success flex-grow-1 fw-bold d-flex align-items-center justify-content-center gap-1" style={{ fontSize: '9px', backgroundColor: '#ecfdf5' }} title="Detailed Attendance Sheet">
                        <Icon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" style={{ width: '12px', height: '12px' }}/> Full Excel
                    </button>
                    <button onClick={() => setPdfModal({ show: true, hideBasic: false })} className="btn btn-sm btn-light border text-danger flex-grow-1 fw-bold d-flex align-items-center justify-content-center gap-1" style={{ fontSize: '9px', backgroundColor: '#fff5f5' }} title="Verification Summary Print">
                        <Icon path="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" style={{ width: '12px', height: '12px' }}/> PDF Print
                    </button>
                </div>

                <div className="border-top pt-2 mt-1">
                    {!dirHandle ? (
                        <button onClick={selectLocalDirectory} className="btn btn-sm w-100 fw-bold d-flex align-items-center justify-content-center gap-1 btn-outline-secondary" style={{ fontSize: '10px', height: '32px' }}>
                            <Icon path="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            Link Local Sync Folder
                        </button>
                    ) : !isDirGranted ? (
                        <button onClick={triggerLocalUnlock} className="btn btn-sm w-100 fw-bold d-flex align-items-center justify-content-center gap-1 btn-warning bg-opacity-25 border-warning text-warning-emphasis" style={{ fontSize: '10px', height: '32px' }}>
                            <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            🔒 Unlock Workspace Folder
                        </button>
                    ) : (
                        <button onClick={selectLocalDirectory} className="btn btn-sm w-100 fw-bold d-flex align-items-center justify-content-center gap-1 btn-success bg-opacity-10 text-success border-success" style={{ fontSize: '10px', height: '32px' }}>
                            <Icon path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            🟢 Folder Synced & Active
                        </button>
                    )}
                </div>
            </div>

            <div className="d-flex bg-secondary bg-opacity-10 p-1 rounded mt-1 gap-1">
                <button onClick={() => setActiveTab('employees')} className={`btn btn-sm flex-grow-1 fw-bold py-1`} style={{ fontSize: '10px', backgroundColor: activeTab === 'employees' ? '#ffffff' : 'transparent', color: activeTab === 'employees' ? '#212529' : '#6c757d', boxShadow: activeTab === 'employees' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>Employees</button>
                <button onClick={() => setActiveTab('logs')} className={`btn btn-sm flex-grow-1 fw-bold py-1`} style={{ fontSize: '10px', backgroundColor: activeTab === 'logs' ? '#ffffff' : 'transparent', color: activeTab === 'logs' ? '#212529' : '#6c757d', boxShadow: activeTab === 'logs' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>Daily Logs</button>
                <button onClick={() => setActiveTab('dashboard')} className={`btn btn-sm flex-grow-1 fw-bold py-1`} style={{ fontSize: '10px', backgroundColor: activeTab === 'dashboard' ? '#ffffff' : 'transparent', color: activeTab === 'dashboard' ? '#212529' : '#6c757d', boxShadow: activeTab === 'dashboard' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>Analytics</button>
            </div>
        </div>
        
        {activeTab === 'employees' ? (
            <>
                <div className="p-3 bg-light border-bottom flex-shrink-0">
                    <div className="position-relative">
                        <Icon path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" className="text-secondary position-absolute" style={{ left: '10px', top: '10px', width: '16px', height: '16px' }} />
                        <input type="text" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)} className="form-control form-control-sm ps-5 bg-white border rounded shadow-sm" style={{ height: '36px', fontSize: '13px' }} />
                    </div>
                    <div className="d-flex justify-content-between align-items-center mt-3 small fw-bold text-secondary text-uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>
                        <span>{filtered.length} People</span>
                        <button onClick={handleResetSystem} className="btn btn-link btn-sm text-danger p-0 border-0 text-decoration-none" style={{ fontSize: '10px' }}>Reset Month</button>
                    </div>
                </div>
                <div className="flex-grow-1 overflow-auto p-2 bg-light d-flex flex-column gap-1 hide-scroll">
                    {filtered.length === 0 && (
                        <div className="d-flex flex-column align-items-center justify-content-center p-3 text-center">
                            <div className="small text-muted fw-semibold mb-3">No records found for {activeConf.label}.</div>
                            {dbs[MONTHS.find(m => m.id !== activeMonthKey).id]?.length > 0 && (
                                <button onClick={handleMigrateEmployees} className="btn btn-sm btn-light border text-brand-600 w-100 fw-bold d-flex align-items-center justify-content-center gap-2 p-3 rounded shadow-sm" style={{ fontSize: '11px', backgroundColor: '#eff6ff' }}>
                                    <Icon path="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" style={{ width: '16px', height: '16px' }}/>
                                    Migrate Workforce Forward
                                </button>
                            )}
                        </div>
                    )}
                    {filtered.map((emp) => (
                        <div key={emp.id} onClick={() => setSelectedId(emp.id)} className="p-3 rounded border cursor-pointer transition-all" style={{
                            backgroundColor: selectedId === emp.id ? '#ffffff' : 'transparent',
                            borderColor: selectedId === emp.id ? 'var(--brand-500)' : 'transparent',
                            boxShadow: selectedId === emp.id ? '0 4px 6px rgba(59, 130, 246, 0.1)' : 'none',
                        }}>
                            <div className="d-flex justify-content-between align-items-start mb-1">
                                <h3 className="fw-bold mb-0 text-truncate text-dark" style={{ fontSize: '13px', maxWidth: '170px' }}>{emp.name}</h3>
                                <span className="badge bg-secondary bg-opacity-10 text-secondary" style={{ fontSize: '9px' }}>{emp.code}</span>
                            </div>
                            <div className="d-flex justify-content-between align-items-center mt-2">
                                <div className="d-flex gap-2">
                                    <span className="small fw-semibold text-success d-flex align-items-center gap-1" style={{ fontSize: '11px' }}><Icon path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" style={{ width: '14px', height: '14px' }}/> {emp.workingDays}</span>
                                    <span className="small fw-semibold text-danger d-flex align-items-center gap-1" style={{ fontSize: '11px' }}><Icon path="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" style={{ width: '14px', height: '14px' }}/> {emp.absent}</span>
                                </div>
                                <span className="fw-bold text-dark" style={{ fontSize: '12px' }}>₹{emp.salaryToBePaid.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </>
        ) : activeTab === 'logs' ? (
            <>
                <div className="p-3 bg-light border-bottom flex-shrink-0">
                    <span className="small fw-bold text-secondary text-uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Select Log Date</span>
                </div>
                <div className="flex-grow-1 overflow-auto p-2 bg-light d-flex flex-column gap-1 hide-scroll">
                    {Array.from({ length: activeConf.days }, (_, i) => i + 1).map(day => (
                        <div key={day} onClick={() => setLogDate(day)} className="p-3 rounded border cursor-pointer transition-all" style={{
                            backgroundColor: logDate === day ? '#ffffff' : 'transparent',
                            borderColor: logDate === day ? 'var(--brand-500)' : 'transparent',
                            boxShadow: logDate === day ? '0 4px 6px rgba(59, 130, 246, 0.1)' : 'none',
                        }}>
                            <div className="d-flex justify-content-between align-items-center">
                                <h3 className="fw-bold mb-0 text-dark" style={{ fontSize: '13px' }}>{activeConf.label.split(' ')[0]} {String(day).padStart(2, '0')}, {activeConf.label.split(' ')[1]}</h3>
                                <span className={`badge ${activeConf.weekends.includes(day) ? 'bg-warning bg-opacity-25 text-warning-emphasis' : 'bg-secondary bg-opacity-10 text-secondary'}`} style={{ fontSize: '9px' }}>{DAY_NAMES[(activeConf.startOffset + day - 1) % 7]}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </>
        ) : (
            <div className="flex-grow-1 bg-light d-flex flex-column p-4 align-items-center justify-content-center text-center">
                <div className="rounded bg-brand-50 d-flex align-items-center justify-content-center mb-3 shadow-inner" style={{ width: '70px', height: '70px' }}><Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" className="text-brand-600" style={{ width: '36px', height: '36px' }} /></div>
                <h2 className="h5 fw-bold text-dark mb-2">Analytics Active</h2>
                <p className="small text-muted mb-3" style={{ fontSize: '12px' }}>View detailed company statistics on the main panel.</p>
                <p className="badge bg-secondary bg-opacity-10 text-secondary fw-semibold p-2 mb-0" style={{ fontSize: '10px' }}>Press 'Esc' to return to Employees</p>
            </div>
        )}
    </div>

    {/* Main Content Area */}
    <div className="flex-grow-1 d-flex flex-column bg-light overflow-hidden h-100 position-relative">
    {activeTab === 'dashboard' ? (
        <OwnerDashboard db={db} activeConf={activeConf} />
    ) : activeTab === 'logs' ? (
        <div className="flex-grow-1 d-flex flex-column h-100 overflow-hidden">
            <div className="bg-white border-bottom p-4 z-1 flex-shrink-0 shadow-sm">
                <div className="d-flex justify-content-between align-items-start">
                    <div>
                        <h2 className="h4 fw-bold text-dark mb-0">Daily Log: {activeConf.label.split(' ')[0]} {logDate}, {activeConf.label.split(' ')[1]}</h2>
                        <p className="small text-muted mb-0 fw-semibold mt-1">{DAY_NAMES[(activeConf.startOffset + logDate - 1) % 7]}</p>
                    </div>
                    <div className="badge bg-light text-secondary border fw-bold p-2 d-none d-md-block" style={{ fontSize: '10px' }}>Press 'Esc' to close</div>
                </div>
                
                {(() => {
                    let p=0, a=0, h=0, t=0, wo=0, l=0, pMiss=0, otTotal=0;
                    db.forEach(emp => {
                        const val = emp[`d${logDate}`] || (emp.autoWoDays?.[logDate] === "W/O" ? "W/O" : "");
                        const aVal = String(val).trim().toUpperCase();
                        const isE = String(emp.type || "").trim().toUpperCase() === "E";
                        const isSunday = activeConf.weekends.includes(logDate);
                        let getsExtraWo = false;
                        if (isE && isSunday && aVal && ['P', 'P?', 'H', '0.5', 'T', 'L'].includes(aVal)) getsExtraWo = true;

                        if (aVal === 'P') p++;
                        else if (aVal === 'P?') { p++; pMiss++; } 
                        else if (aVal === 'A') a++;
                        else if (aVal === 'H' || aVal === '0.5') h++;
                        else if (aVal === 'T') t++;
                        else if (aVal === 'W/O') wo++;
                        else if (aVal === 'L') l++;

                        if (getsExtraWo) wo++;
                        const ot = parseFloat(emp[`ot${logDate}`]);
                        if(!isNaN(ot)) otTotal += ot;
                    });

                    return (
                        <div className="row g-2 mt-4 border-top pt-4">
                            <div className="col-6 col-md-4 col-lg-2">
                                <div className="p-3 bg-success bg-opacity-10 rounded border border-success border-opacity-10">
                                    <div className="fw-bold text-success text-uppercase mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Present</div>
                                    <div className="h4 fw-bold text-success mb-0">{p}</div>
                                </div>
                            </div>
                            <div className="col-6 col-md-4 col-lg-2">
                                <div className="p-3 bg-status-l bg-opacity-10 rounded border border-indigo border-opacity-10">
                                    <div className="fw-bold text-indigo text-uppercase mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Paid Leaves</div>
                                    <div className="h4 fw-bold text-indigo mb-0">{l}</div>
                                </div>
                            </div>
                            <div className="col-6 col-md-4 col-lg-2">
                                <div className="p-3 bg-warning bg-opacity-10 rounded border border-warning border-opacity-10">
                                    <div className="fw-bold text-warning-emphasis text-uppercase mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Half Day</div>
                                    <div className="h4 fw-bold text-warning mb-0">{h}</div>
                                </div>
                            </div>
                            <div className="col-6 col-md-4 col-lg-2">
                                <div className="p-3 bg-danger bg-opacity-10 rounded border border-danger border-opacity-10">
                                    <div className="fw-bold text-danger text-uppercase mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Absent</div>
                                    <div className="h4 fw-bold text-danger mb-0">{a}</div>
                                </div>
                            </div>
                            <div className="col-6 col-md-4 col-lg-2">
                                <div className="p-3 bg-info bg-opacity-10 rounded border border-info border-opacity-10">
                                    <div className="fw-bold text-info-emphasis text-uppercase mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Tour</div>
                                    <div className="h4 fw-bold text-info mb-0">{t}</div>
                                </div>
                            </div>
                            <div className="col-6 col-md-4 col-lg-1">
                                <div className="p-3 bg-primary bg-opacity-10 rounded border border-primary border-opacity-10">
                                    <div className="fw-bold text-primary text-uppercase mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>W/O</div>
                                    <div className="h4 fw-bold text-primary mb-0">{wo}</div>
                                </div>
                            </div>
                            <div className="col-6 col-md-4 col-lg-1">
                                <div className="p-3 bg-brand-50 rounded border border-brand-100">
                                    <div className="fw-bold text-brand-600 text-uppercase mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>OT (Hrs)</div>
                                    <div className="h4 fw-bold text-brand-600 mb-0">{otTotal}</div>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>

            <div className="flex-grow-1 overflow-auto p-4 bg-light">
                <div className="card border shadow-sm rounded-3 overflow-hidden bg-white">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead className="table-light text-secondary text-uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>
                                <tr>
                                    <th className="p-3 fw-bold">Employee Details</th>
                                    <th className="p-3 fw-bold">Code</th>
                                    <th className="p-3 fw-bold">Attendance Status</th>
                                    <th className="p-3 fw-bold">In / Out Time</th>
                                    <th className="p-3 fw-bold">Overtime (OT)</th>
                                </tr>
                            </thead>
                            <tbody className="text-dark" style={{ fontSize: '13px' }}>
                                {db.map(emp => {
                                    const manualVal = emp[`d${logDate}`];
                                    const autoWoVal = !manualVal && emp.autoWoDays?.[logDate] === "W/O" ? "W/O" : "";
                                    const aVal = manualVal ? String(manualVal).toUpperCase() : autoWoVal;
                                    const otVal = emp[`ot${logDate}`];
                                    return (
                                        <tr key={emp.id}>
                                            <td className="p-3 fw-bold text-dark">{emp.name}</td>
                                            <td className="p-3 fw-bold text-secondary">{emp.code}</td>
                                            <td className="p-3">
                                                <span className={`badge ${aVal ? getAttColor(aVal).replace('bg-status-p', 'bg-success').replace('bg-status-a', 'bg-danger').replace('bg-status-l', 'bg-status-l text-white').replace('bg-status-h', 'bg-warning text-dark').replace('bg-slate-100', 'bg-secondary bg-opacity-10 text-secondary').replace('text-white', '') : 'bg-secondary bg-opacity-10 text-secondary'}`} style={{ fontSize: '10px', padding: '6px 10px' }}>
                                                    {aVal || 'UNMARKED'}
                                                </span>
                                            </td>
                                            <td className="p-3 fw-bold text-secondary" style={{ fontSize: '11px' }}>
                                                {emp[`in${logDate}`] && <div className="text-success">IN: {emp[`in${logDate}`]}</div>}
                                                {emp[`out${logDate}`] && <div className="text-danger">OUT: {emp[`out${logDate}`]}</div>}
                                                {!emp[`in${logDate}`] && !emp[`out${logDate}`] && '-'}
                                            </td>
                                            <td className="p-3">
                                                {otVal ? <span className={`badge border ${parseFloat(otVal) < 0 ? 'bg-danger bg-opacity-10 text-danger border-danger border-opacity-10' : 'bg-brand-100 text-brand-700 border-brand-200'}`} style={{ fontSize: '10px' }}>{otVal} Hrs</span> : '-'}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    ) : !activeEmp ? (
        <div className="flex-grow-1 d-flex flex-column align-items-center justify-content-center text-secondary">
            <div className="rounded-4 bg-secondary bg-opacity-10 d-flex align-items-center justify-content-center mb-4" style={{ width: '90px', height: '90px' }}>
                <Icon path="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" style={{ width: '48px', height: '48px', color: '#6c757d' }} />
            </div>
            <h2 className="h4 fw-bold text-secondary mb-2">Select an Employee</h2>
            <p className="small text-muted text-center mb-0" style={{ maxWidth: '280px' }}>Use the sidebar to choose an employee, or start typing to search.</p>
        </div>
    ) : (
        <div className="flex-grow-1 d-flex flex-column h-100 overflow-hidden">
            <div className="bg-white border-bottom p-4 z-1 flex-shrink-0 shadow-sm">
                <div className="d-flex justify-content-between align-items-start">
                    <div className="d-flex align-items-center gap-3">
                        <div className="rounded text-white d-flex align-items-center justify-content-center text-uppercase fw-bold" style={{ width: '60px', height: '60px', fontSize: '24px', background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}>{activeEmp.name.charAt(0)}</div>
                        <div>
                            <input type="text" value={activeEmp.name} onChange={e => updateActive({name: e.target.value})} className="form-control form-control-lg fw-bold border-0 p-0 mb-1 text-dark" style={{ fontSize: '24px', outline: 'none', background: 'transparent', boxShadow: 'none' }} />
                            <div className="d-flex flex-wrap align-items-center gap-1">
                                <input type="text" value={activeEmp.code} onChange={e => updateActive({code: e.target.value})} className="form-control form-control-sm text-center fw-bold bg-light text-secondary border p-1" style={{ width: '90px', fontSize: '11px' }} />
                                <input type="text" value={activeEmp.dept} onChange={e => updateActive({dept: e.target.value})} className="form-control form-control-sm text-center fw-bold bg-light text-secondary border p-1" style={{ width: '120px', fontSize: '11px' }} />
                                <input type="text" value={activeEmp.type} onChange={e => updateActive({type: e.target.value})} className="form-control form-control-sm text-center fw-bold bg-light text-secondary border p-1" style={{ width: '50px', fontSize: '11px' }} placeholder="Type" />
                                <input type="date" value={activeEmp.joiningDate || ""} onChange={e => updateActive({joiningDate: e.target.value})} className="form-control form-control-sm text-center fw-bold bg-light text-secondary border p-1" style={{ width: '130px', fontSize: '11px' }} title="Joining Date" />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-4 d-flex flex-wrap gap-4 border-top pt-3">
                    <div className="d-flex flex-column"><span className="small text-muted text-uppercase fw-bold" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Working/Paid Days</span><span className="h5 fw-bold text-dark mb-0">{activeEmp.workingDays}</span></div>
                    <div className="d-flex flex-column"><span className="small text-success text-uppercase fw-bold" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Present (P)</span><span className="h5 fw-bold text-success mb-0">{activeEmp.pOnly}</span></div>
                    <div className="d-flex flex-column"><span className="small text-brand-600 text-uppercase fw-bold" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Paid Leave (L)</span><span className="h5 fw-bold text-brand-600 mb-0">{activeEmp.leave || 0}</span></div>
                    <div className="d-flex flex-column"><span className="small text-warning text-uppercase fw-bold" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Missing (P?)</span><span className="h5 fw-bold text-warning mb-0">{activeEmp.pMiss}</span></div>
                    <div className="d-flex flex-column"><span className="small text-brand-600 text-uppercase fw-bold" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Total OT</span><span className="h5 fw-bold text-brand-600 mb-0">{activeEmp.otHrs}h</span></div>
                </div>

                <div className="row row-cols-2 row-cols-md-5 g-2 mt-3">
                    <div className="col">
                        <div className="p-3 bg-light rounded border h-100 d-flex flex-column justify-content-between" style={{ minHeight: '80px' }}>
                            <div className="small text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Basic Salary</div>
                            <div className="d-flex align-items-center"><span className="text-secondary fw-bold me-1">₹</span><input type="number" value={activeEmp.basicSalary || ""} onChange={e => updateActive({basicSalary: e.target.value})} className="form-control form-control-sm fw-bold border-0 p-0 text-dark bg-transparent shadow-none" style={{ fontSize: '15px', outline: 'none' }} /></div>
                        </div>
                    </div>
                    <div className="col">
                        <div className="p-3 bg-success bg-opacity-10 rounded border border-success border-opacity-10 h-100 d-flex flex-column justify-content-between" style={{ minHeight: '80px' }}>
                            <div className="small text-success text-uppercase fw-bold mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Earned Pay</div>
                            <div className="d-flex align-items-center"><span className="text-success fw-bold me-1">₹</span><span className="fw-bold text-success" style={{ fontSize: '15px' }}>{activeEmp.actualMonthly.toLocaleString(undefined, {maximumFractionDigits:0})}</span></div>
                        </div>
                    </div>
                    <div className="col">
                        <div className="p-3 bg-light rounded border h-100 d-flex flex-column justify-content-between" style={{ minHeight: '80px' }}>
                            <div className="small text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Prev Balance</div>
                            <div className="d-flex align-items-center"><span className="text-secondary fw-bold me-1">₹</span><input type="number" value={activeEmp.previousBalance || ""} onChange={e => updateActive({previousBalance: e.target.value})} className="form-control form-control-sm fw-bold border-0 p-0 text-dark bg-transparent shadow-none" style={{ fontSize: '15px', outline: 'none' }} /></div>
                        </div>
                    </div>
                    <div className="col">
                        <div className="p-3 bg-danger bg-opacity-10 rounded border border-danger border-opacity-10 h-100 d-flex flex-column justify-content-between" style={{ minHeight: '80px' }}>
                            <div className="small text-danger text-uppercase fw-bold mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Advance Deduct</div>
                            <div className="d-flex align-items-center"><span className="text-danger fw-bold me-1">₹</span><input type="number" value={activeEmp.advance || ""} onChange={e => updateActive({advance: e.target.value})} className="form-control form-control-sm fw-bold border-0 p-0 text-dark bg-transparent shadow-none" style={{ fontSize: '15px', outline: 'none' }} /></div>
                        </div>
                    </div>
                    <div className="col">
                        <div className="p-3 bg-dark text-white rounded border d-flex flex-column justify-content-between shadow h-100" style={{ minHeight: '80px' }}>
                            <div className="small text-secondary text-uppercase fw-bold mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Final Payout</div>
                            <div className="d-flex align-items-center"><span className="text-secondary fw-bold me-1">₹</span><span className="fw-bold text-white" style={{ fontSize: '16px' }}>{activeEmp.salaryToBePaid.toLocaleString(undefined, {maximumFractionDigits:0})}</span></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Calendar Day grid */}
            <div className="flex-grow-1 overflow-auto p-4 bg-light" onClick={() => { if(!focusDay) setFocusDay(1); }}>
                <div className="d-flex align-items-center justify-content-between mb-3">
                    <h3 className="h6 fw-bold text-dark mb-0">{activeConf.label} Register</h3>
                    <div className="d-flex align-items-center gap-2 bg-white px-3 py-2 rounded border shadow-sm" style={{ fontSize: '11px', fontWeight: 'bold' }}>
                        <span className="text-secondary"><kbd className="bg-light text-dark border">P</kbd> Prs (Time)</span>
                        <span className="text-secondary"><kbd className="bg-light text-dark border">L</kbd> Paid Leave</span>
                        <span className="text-secondary"><kbd className="bg-light text-dark border">A</kbd> Abs</span>
                        <span className="text-secondary"><kbd className="bg-light text-dark border">H</kbd> Half</span>
                        <span className="text-secondary"><kbd className="bg-light text-dark border">T</kbd> Tour</span>
                        <span className="text-secondary"><kbd className="bg-light text-dark border">O</kbd> OT</span>
                        <span className="text-secondary"><kbd className="bg-light text-dark border">⌫</kbd> Clr</span>
                    </div>
                </div>

                <div className="grid-7 pb-5">
                    {DAY_NAMES.map(d => <div key={d} className="text-center small fw-bold text-secondary text-uppercase" style={{ letterSpacing: '0.5px', fontSize: '10px' }}>{d}</div>)}
                    
                    {Array.from({ length: activeConf.startOffset }).map((_, i) => <div key={`empty-${i}`} className="opacity-0"></div>)}
                    {Array.from({ length: activeConf.days }, (_, i) => {
                        const dNum = i + 1;
                        const isWk = activeConf.weekends.includes(dNum);
                        const manualVal = activeEmp[`d${dNum}`];
                        const autoWoVal = !manualVal && activeEmp.autoWoDays?.[dNum] === "W/O" ? "W/O" : "";
                        const aVal = manualVal ? String(manualVal).toUpperCase() : autoWoVal;
                        const isAutoWo = !manualVal && autoWoVal === "W/O";
                        const isE = String(activeEmp.type || "").trim().toUpperCase() === "E";
                        const getsExtraWo = isWk && isE && manualVal && ['P', 'P?', 'H', '0.5', 'T', 'L'].includes(String(manualVal).toUpperCase());
                        const oVal = activeEmp[`ot${dNum}`];
                        const cVal = activeEmp[`c${dNum}`];
                        const inVal = activeEmp[`in${dNum}`];
                        const outVal = activeEmp[`out${dNum}`];
                        
                        let customBg = "bg-white";
                        let textClass = "text-dark";
                        if (aVal === 'P') { customBg = "bg-success text-white border-success"; textClass="text-white"; }
                        else if (aVal === 'P?') { customBg = "bg-warning text-dark border-warning"; textClass="text-dark"; }
                        else if (aVal === 'A') { customBg = "bg-danger text-white border-danger"; textClass="text-white"; }
                        else if (aVal === '0.5' || aVal === 'H') { customBg = "bg-warning text-dark border-warning"; textClass="text-dark"; }
                        else if (aVal === 'T') { customBg = "bg-info text-white border-info"; textClass="text-white"; }
                        else if (aVal === 'W/O') { customBg = "bg-primary text-white border-primary"; textClass="text-white"; }
                        else if (aVal === 'L') { customBg = "bg-status-l text-white border-status-l"; textClass="text-white"; }
                        else if (isWk) { customBg = "bg-warning bg-opacity-10 border-light"; }

                        return (
                            <div id={`day-${dNum}`} key={dNum} tabIndex={0} onClick={() => setFocusDay(dNum)} className="day-card position-relative rounded border p-2 bg-white d-flex flex-column justify-content-between" style={{
                                height: '110px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                outline: 'none',
                                borderWidth: '2px',
                                borderColor: focusDay === dNum ? 'var(--brand-500)' : '#dee2e6',
                                boxShadow: focusDay === dNum ? '0 0 0 4px rgba(59, 130, 246, 0.2)' : 'none',
                                backgroundColor: isWk && !aVal ? '#fffbeb' : '#ffffff'
                            }}>
                                <span className="small fw-bold text-secondary position-absolute" style={{ top: '8px', left: '10px' }}>{dNum}</span>
                                {cVal && (
                                    <div className="position-absolute text-primary bg-primary bg-opacity-10 p-1 rounded z-2" style={{ top: '8px', right: '10px', cursor: 'pointer' }} title={cVal} onClick={(e) => { e.stopPropagation(); setFocusDay(dNum); setCommentModal({ show: true, day: dNum, val: cVal }); }}>
                                        <Icon path="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" style={{ width: '14px', height: '14px' }}/>
                                    </div>
                                )}
                                
                                <div className="flex-grow-1 d-flex flex-column align-items-center justify-content-center mt-3 gap-1">
                                    <div className="d-flex align-items-center gap-1">
                                        <div className={`rounded d-flex align-items-center justify-content-center fw-bold ${customBg}`} style={{
                                            width: '32px',
                                            height: '32px',
                                            fontSize: '12px',
                                            border: isAutoWo ? '2px dashed var(--brand-500)' : '1px solid transparent',
                                            opacity: isAutoWo ? 0.7 : 1,
                                            color: isAutoWo ? 'var(--brand-600)' : 'inherit'
                                        }}>{aVal || '-'}</div>
                                        {oVal && <div className={`badge border ${parseFloat(oVal) < 0 ? 'bg-danger bg-opacity-10 text-danger border-danger border-opacity-10' : 'bg-brand-100 text-brand-700 border-brand-200'}`} style={{ fontSize: '9px' }}>{oVal}h</div>}
                                    </div>
                                    
                                    {(inVal || outVal) && (
                                        <div className="fw-bold text-secondary text-center mt-1" style={{ fontSize: '9px', lineHeight: '1.2' }}>
                                            {inVal && <div className="text-success">↑ {inVal}</div>}
                                            {outVal && <div className="text-danger">↓ {outVal}</div>}
                                        </div>
                                    )}
                                </div>
                                {getsExtraWo && <div className="position-absolute bottom-0 start-0 end-0 text-center pb-1"><span className="badge bg-primary bg-opacity-10 text-primary uppercase fw-bold" style={{ fontSize: '8px' }}>+ W/O</span></div>}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    )}
    </div>

    {/* TIME SELECTION DIALOG BOX */}
    {timeModal.show && (
        <div className="modal-overlay" onClick={() => setTimeModal({...timeModal, show: false})}>
            <div className="card shadow-lg p-4 bg-white" style={{ width: '600px', maxWidth: '95%', borderRadius: '16px' }} onClick={e => e.stopPropagation()}>
                <button onClick={() => setTimeModal({...timeModal, show: false})} className="btn-close position-absolute top-0 end-0 m-3" aria-label="Close"></button>
                
                <div className="mb-4 d-flex align-items-center justify-content-between border-bottom pb-3">
                    <div>
                        <h3 className={`h4 fw-bold mb-0 d-flex align-items-center gap-2 ${timeModal.step === 'in' ? 'text-success' : 'text-danger'}`}>
                            {timeModal.step === 'in' ? <Icon path="M5 10l7-7m0 0l7 7m-7-7v18" className="w-6 h-6"/> : <Icon path="M19 14l-7 7m0 0l-7-7m7 7V3" className="w-6 h-6"/>}
                            {timeModal.step === 'in' ? 'Select Clock IN Time' : 'Select Clock OUT Time'}
                        </h3>
                        <p className="small text-muted mb-0 fw-bold mt-1 text-uppercase tracking-widest">{activeEmp?.name} • Day {timeModal.day}</p>
                    </div>
                </div>

                {/* Quick Suggestions Row */}
                <div className="mb-4">
                    <h4 className="small fw-bold text-secondary text-uppercase mb-2" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Common {timeModal.step === 'in' ? 'IN' : 'OUT'} Times</h4>
                    <div className="row g-2">
                        {(timeModal.step === 'in' ? SUGGESTED_IN_TIMES : SUGGESTED_OUT_TIMES).map((timeStr, idx) => (
                            <div key={idx} className="col-3">
                                <button 
                                    onClick={() => handleTimeSelect(timeStr)}
                                    className={`btn btn-sm w-100 fw-bold py-2 border ${
                                        timeModal.step === 'in' 
                                        ? 'btn-success bg-opacity-10 border-success text-success' 
                                        : 'btn-danger bg-opacity-10 border-danger text-danger'
                                    }`}
                                    style={{ fontSize: '12px' }}
                                >
                                    {timeStr}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <h4 className="small fw-bold text-secondary text-uppercase mb-2 border-top pt-3" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>All Time Options</h4>
                <div className="row g-2 overflow-auto mb-4 time-grid" style={{ maxHeight: '200px' }}>
                    {(timeModal.step === 'in' ? inTimeOptions : outTimeOptions).map((timeStr, idx) => (
                        <div key={idx} className="col-3">
                            <button 
                                onClick={() => handleTimeSelect(timeStr)}
                                className={`btn btn-sm w-100 border py-2 ${
                                    timeModal.step === 'in' 
                                    ? 'btn-outline-success border-success' 
                                    : 'btn-outline-danger border-danger'
                                }`}
                                style={{ fontSize: '10px' }}
                            >
                                {timeStr}
                            </button>
                        </div>
                    ))}
                </div>

                <div className="row g-2 border-top pt-3 bg-light p-3 rounded align-items-end">
                    <div className="col-8 text-start">
                        <p className="small fw-bold text-secondary text-uppercase mb-1" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>Or Enter Custom Time</p>
                        <input 
                            type="time" 
                            value={timeModal.custom}
                            onChange={(e) => setTimeModal({...timeModal, custom: e.target.value})}
                            className="form-control form-control-sm"
                        />
                    </div>
                    <div className="col-4">
                        <button 
                            onClick={handleTimeCustomSave} 
                            className={`btn btn-sm w-100 fw-bold py-2 text-white ${timeModal.step === 'in' ? 'btn-success' : 'btn-danger'}`}
                        >
                            Save Custom
                        </button>
                    </div>
                </div>
                
                <button onClick={() => setTimeModal({...timeModal, show: false})} className="btn btn-link btn-sm text-secondary mt-3 p-0 text-decoration-none">Skip Time Selection</button>
            </div>
        </div>
    )}

    {/* PDF EXPORT SETUP DIALOG BOX */}
    {pdfModal.show && (
        <div className="modal-overlay" onClick={() => setPdfModal({...pdfModal, show: false})}>
            <div className="card shadow-lg p-4 bg-white" style={{ width: '450px', maxWidth: '95%', borderRadius: '16px' }} onClick={e => e.stopPropagation()}>
                <h3 className="h5 fw-bold text-dark mb-3 d-flex align-items-center gap-2 border-bottom pb-2">
                    <Icon path="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" className="text-danger"/> 
                    Configure Verification Print
                </h3>
                
                <div className="mb-3 bg-light border p-3 rounded">
                    <div className="form-check text-start">
                        <input type="checkbox" checked={pdfModal.hideBasic} onChange={e => setPdfModal({...pdfModal, hideBasic: e.target.checked})} className="form-check-input" id="hideBasicCheck" />
                        <label className="form-check-label" htmlFor="hideBasicCheck">
                            <div className="small fw-bold text-dark">Hide Basic Salary</div>
                            <div className="text-secondary" style={{ fontSize: '10px' }}>Omit base pay column from the PDF print</div>
                        </label>
                    </div>
                </div>

                <div className="mb-4">
                    <h4 className="small fw-bold text-secondary text-uppercase mb-3 d-flex align-items-center gap-2 text-start" style={{ fontSize: '10px', letterSpacing: '0.5px' }}><Icon path="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" className="w-3.5 h-3.5"/> Signature Authorities</h4>
                    <div className="row g-2 text-start">
                        <div className="col-6">
                            <label className="form-label small text-secondary mb-1" style={{ fontSize: '10px' }}>Prepared By</label>
                            <input type="text" value={pdfSigs.prep} onChange={e => setPdfSigs({...pdfSigs, prep: e.target.value.toUpperCase()})} className="form-control form-control-sm text-uppercase fw-bold text-dark"/>
                        </div>
                        <div className="col-6">
                            <label className="form-label small text-secondary mb-1" style={{ fontSize: '10px' }}>Rechecked By</label>
                            <input type="text" value={pdfSigs.rech} onChange={e => setPdfSigs({...pdfSigs, rech: e.target.value.toUpperCase()})} className="form-control form-control-sm text-uppercase fw-bold text-dark"/>
                        </div>
                        <div className="col-6">
                            <label className="form-label small text-secondary mb-1" style={{ fontSize: '10px' }}>Verified By</label>
                            <input type="text" value={pdfSigs.ver} onChange={e => setPdfSigs({...pdfSigs, ver: e.target.value.toUpperCase()})} className="form-control form-control-sm text-uppercase fw-bold text-dark"/>
                        </div>
                        <div className="col-6">
                            <label className="form-label small text-secondary mb-1" style={{ fontSize: '10px' }}>Final Approval</label>
                            <input type="text" value={pdfSigs.app} onChange={e => setPdfSigs({...pdfSigs, app: e.target.value.toUpperCase()})} className="form-control form-control-sm text-uppercase fw-bold text-dark"/>
                        </div>
                    </div>
                </div>

                <div className="d-flex gap-2 justify-content-end pt-2">
                    <button onClick={() => setPdfModal({...pdfModal, show:false})} className="btn btn-sm btn-light border fw-bold text-secondary px-3">Cancel</button>
                    <button onClick={executePDFExport} className="btn btn-sm btn-danger fw-bold text-white px-3 d-flex align-items-center gap-2">
                        <Icon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" className="w-4 h-4"/> Generate PDF
                    </button>
                </div>
            </div>
        </div>
    )}

    {/* OVERTIME / PENALTY EDIT DIALOG BOX */}
    {otModal.show && (
        <div className="modal-overlay" onClick={() => setOtModal({...otModal, show: false})}>
            <div className="card shadow-lg p-4 bg-white" style={{ width: '320px', borderRadius: '16px' }} onClick={e => e.stopPropagation()}>
                <h3 className="h6 fw-bold text-dark mb-3 d-flex align-items-center gap-2"><Icon path="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" className="text-primary"/> Day {otModal.day} Overtime/Penalty</h3>
                <div className="mb-4">
                    <input type="number" step="0.5" ref={otInputRef} value={otModal.val} onChange={e => setOtModal({...otModal, val: e.target.value})} onKeyDown={e => { if(e.key === 'Enter') updateOt(otModal.day, otModal.val); }} className="form-control form-control-lg text-center fw-bold text-dark bg-light" style={{ fontSize: '32px' }} placeholder="0.0" />
                    <p className="text-center small text-muted mt-2 mb-0 fw-semibold">Use negative (-) for penalty</p>
                </div>
                <div className="d-flex gap-2 justify-content-end">
                    <button onClick={() => setOtModal({...otModal, show:false})} className="btn btn-sm btn-light border fw-bold text-secondary">Cancel</button>
                    <button onClick={() => updateOt(otModal.day, otModal.val)} className="btn btn-sm btn-primary fw-bold text-white">Save OT</button>
                </div>
            </div>
        </div>
    )}

    {/* COMMENT/NOTE DIALOG BOX */}
    {commentModal.show && (
        <div className="modal-overlay" onClick={() => setCommentModal({...commentModal, show: false})}>
            <div className="card shadow-lg p-4 bg-white" style={{ width: '400px', maxWidth: '95%', borderRadius: '16px' }} onClick={e => e.stopPropagation()}>
                <h3 className="h6 fw-bold text-dark mb-3 d-flex align-items-center gap-2"><Icon path="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" className="text-primary"/> Date Comment - Day {commentModal.day}</h3>
                <div className="mb-4">
                    <textarea ref={commentInputRef} value={commentModal.val} onChange={e => setCommentModal({...commentModal, val: e.target.value})} className="form-control text-dark bg-light" style={{ fontSize: '13px', height: '120px', resize: 'none' }} placeholder="Add a comment about this day (e.g. Missing punch time, Late by 1 hr, etc...)" />
                </div>
                <div className="d-flex gap-2 justify-content-end">
                    <button onClick={() => setCommentModal({...commentModal, show:false})} className="btn btn-sm btn-light border fw-bold text-secondary">Cancel</button>
                    <button onClick={() => updateComment(commentModal.day, commentModal.val)} className="btn btn-sm btn-primary fw-bold text-white">Save Note</button>
                </div>
            </div>
        </div>
    )}

    {/* NOTIFICATION TOAST OVERLAY */}
    {toast && (
        <div className="position-fixed bottom-0 end-0 p-4" style={{ zIndex: 1100 }}>
            <div className={`toast show align-items-center border-0 text-white p-3 ${toast.type === 'error' ? 'bg-danger' : 'bg-dark'}`} role="alert" aria-live="assertive" aria-atomic="true">
                <div className="d-flex gap-2 align-items-center">
                    <Icon path={toast.type==='error'?"M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z":"M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"} />
                    <div className="toast-body p-0 fw-bold">{toast.msg}</div>
                </div>
            </div>
        </div>
    )}

</div>
);
};

const r = ReactDOM.createRoot(document.getElementById('root'));
r.render(<App />);
