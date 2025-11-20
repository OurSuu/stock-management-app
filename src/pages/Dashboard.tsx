import React, { useState, useEffect, useCallback, useRef } from 'react';

import { supabase } from '../lib/supabase';

import MonthlyChart from '../components/MonthlyChart';
import BranchCard from '../components/BranchCard';
import StockAlerts from '../components/StockAlerts';
import CreateBranchModal from '../components/CreateBranchModal';
import CreateProductModal from '../components/CreateProductModal';
import ProductDistributionModal from '../components/ProductDistributionModal';
import BranchDetailModal from '../components/BranchDetailModal'; // เพิ่ม import

type BranchSummary = { id: string; branch_name: string; status: 'good' | 'warning' | 'critical'; total_stock_value: number; };
type UsageSummary = { name: string; unit: string; received: number; used: number; remaining: number; };

type LowStockItem = {
    id: number;
    branch_id?: string; // เพิ่ม branch_id
    branch_name: string;
    product_name: string;
    current_quantity: number;
    min_alert: number;
    unit: string;
};

const Dashboard: React.FC = () => {

    const [branches, setBranches] = useState<BranchSummary[]>([]);
    const [globalSummary, setGlobalSummary] = useState<{ today: UsageSummary[], month: UsageSummary[] }>({ today: [], month: [] });
    const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false);
    const [isCreateProductOpen, setIsCreateProductOpen] = useState(false);
    const [isDistributionOpen, setIsDistributionOpen] = useState(false);

    // เพิ่มบรรทัดนี้ในส่วนประกาศ State ด้านบน
    const [selectedBranchId, setSelectedBranchId] = useState<{id: string, name: string} | null>(null);

    // ==== เดิม ====
    // const [alertModalBranchId, setAlertModalBranchId] = useState<string | null>(null);
    // const handleAlertClick = (branchId: string | undefined) => {
    //     if (!branchId) return;
    //     setAlertModalBranchId(branchId);
    //     // สามารถเพิ่ม logic เปิด modal เฉพาะกิจเวลา alert ของสาขานั้นๆได้ที่นี่
    // };
    // const handleCloseAlertModal = () => setAlertModalBranchId(null);

    // แก้ไขฟังก์ชันนี้ให้ set state เพื่อเปิด Modal
    const handleAlertClick = (branchId: string, branchName: string) => {
        if (!branchId) return;
        setSelectedBranchId({ id: branchId, name: branchName });
    };

    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    // ====== แก้ไข logic เวลาไทยให้ถูกต้องแบบแน่นอน (ใช้ช่วงเวลา เดือนไทยเดียวกันกับวัน) ======

    // ฟังก์ชันคืนค่า timestamp [start, end] แบบ UTC ของ 'วันนี้เวลาไทย' (เช่น 21 มิ.ย. 00:00 ถึง 21 มิ.ย. 23:59:59.999/22 มิ.ย. 00:00)
    const getTodayThaiMidnightRange = () => {
        // UTC+7: Get now in TH time
        const nowUtc = new Date();
        const utc7OffsetMs = 7 * 60 * 60 * 1000;
        const nowThai = new Date(nowUtc.getTime() + utc7OffsetMs);

        const thaiYear = nowThai.getFullYear();
        const thaiMonth = nowThai.getMonth();
        const thaiDate = nowThai.getDate();

        const todayThaiMidnightUtc = new Date(Date.UTC(thaiYear, thaiMonth, thaiDate, 0, 0, 0) - utc7OffsetMs);
        const tomorrowThaiMidnightUtc = new Date(Date.UTC(thaiYear, thaiMonth, thaiDate + 1, 0, 0, 0) - utc7OffsetMs);

        return {
            start: todayThaiMidnightUtc.toISOString(),
            end: tomorrowThaiMidnightUtc.toISOString()
        };
    };

    // คืน timestamp start, end ของ "เดือนนี้ ตามเวลาไทย" (start: 1st 00:00+07, end: ถัดไปเดือน 1st 00:00+07)
    const getThisThaiMonthRange = () => {
        const nowUtc = new Date();
        const utc7OffsetMs = 7 * 60 * 60 * 1000;
        const nowThai = new Date(nowUtc.getTime() + utc7OffsetMs);
        const thaiYear = nowThai.getFullYear();
        const thaiMonth = nowThai.getMonth();

        // Start: first day of this month, Thai time 00:00
        const monthStartThaiUtc = new Date(Date.UTC(thaiYear, thaiMonth, 1, 0, 0, 0) - utc7OffsetMs);
        // End: first day of next month, Thai time 00:00
        const monthEndThaiUtc = new Date(Date.UTC(thaiYear, thaiMonth + 1, 1, 0, 0, 0) - utc7OffsetMs);

        return {
            start: monthStartThaiUtc.toISOString(), // >= this
            end: monthEndThaiUtc.toISOString() // < this
        };
    };

    // รับวันที่/UTC string คืน "YYYY-MM-DD" ตามวันที่ไทยจริง
    const toThaiISODate = (dateInput: string | Date) => {
        const d = new Date(dateInput);
        const thaiTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        return thaiTime.toISOString().split('T')[0];
    };
    const toThaiISOMonth = (dateInput: string | Date) => {
        const d = new Date(dateInput);
        const thaiTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        return thaiTime.toISOString().slice(0, 7);
    };

    const fetchData = useCallback(async () => {
        try {
            // 1. ดึงข้อมูลสาขา
            const { data: branchData } = await supabase.from('branches').select('*').order('branch_name');

            // 2. ดึงข้อมูล Stock
            const { data: allStock } = await supabase
                .from('stock')
                .select('id, current_quantity, products(name, min_alert_quantity, unit), branches(id, branch_name)');

            // --- คำนวณ Alerts และ Remaining ---
            const alerts: LowStockItem[] = [];
            const branchStatusMap = new Map<string, 'good' | 'warning' | 'critical'>();
            const productRemainingMap = new Map<string, number>();

            allStock?.forEach((item: any) => {
                const qty = item.current_quantity;
                const min = item.products?.min_alert_quantity || 0;
                const branchId = item.branches?.id;
                const prodName = item.products?.name || 'Unknown';

                const currentTotal = productRemainingMap.get(prodName) || 0;
                productRemainingMap.set(prodName, currentTotal + qty);

                if (qty <= min) {
                    alerts.push({
                        id: item.id,
                        branch_id: branchId, // เพิ่ม branch_id ใน alert item
                        branch_name: item.branches?.branch_name || 'ไม่ระบุ',
                        product_name: prodName,
                        current_quantity: qty,
                        min_alert: min,
                        unit: item.products?.unit || ''
                    });
                    const currentStatus = branchStatusMap.get(branchId) || 'good';
                    if (qty === 0) branchStatusMap.set(branchId, 'critical');
                    else if (currentStatus !== 'critical') branchStatusMap.set(branchId, 'warning');
                }
            });

            if (isMounted.current) {
                setLowStockItems(alerts);
                const mappedBranches: BranchSummary[] = (branchData || []).map((b: any) => ({
                    ...b,
                    status: branchStatusMap.get(b.id) || 'good',
                    total_stock_value: 0
                }));
                setBranches(mappedBranches);
            }

            // ---------- ดึง Transaction ให้ตรง Local Thai Day และ Local Thai Month ----------

            // สำหรับวันนี้ (ไทย)
            const { start: thaiMidnightStart, end: thaiMidnightEnd } = getTodayThaiMidnightRange();
            // สำหรับเดือนนี้ (ไทย)
            const { start: thaiMonthStart, end: thaiMonthEnd } = getThisThaiMonthRange();

            // ดึง txn ตั้งแต่ต้นเดือน (ตามช่วงเดือนไทย)
            const { data: txnData } = await supabase
                .from('transactions')
                .select('*, products(name, unit)')
                .gte('created_at', thaiMonthStart)
                .lt('created_at', thaiMonthEnd);

            // เตรียมสรุป
            const todayMap = new Map<string, UsageSummary>();
            const monthMap = new Map<string, UsageSummary>();

            const getOrInit = (map: Map<string, UsageSummary>, name: string, unit: string) => {
                if (!map.has(name)) {
                    map.set(name, {
                        name,
                        unit,
                        received: 0,
                        used: 0,
                        remaining: productRemainingMap.get(name) || 0
                    });
                }
                return map.get(name)!;
            };

            txnData?.forEach((t: any) => {
                // created_at เป็น UTC ISO string เช่น "2024-06-09T07:24:30.612Z"
                const createdAtUTC = t.created_at;
                // วันนี้ (ไทย)
                let inThaiToday = false;
                if (createdAtUTC >= thaiMidnightStart && createdAtUTC < thaiMidnightEnd) {
                    inThaiToday = true;
                }

                const prodName = t.products?.name || 'สินค้าไม่ระบุชื่อ';
                const unit = t.products?.unit || '';
                const qty = t.quantity_change;
                const type = t.type;

                // เดือนนี้ (ตามช่วง Thai เดือน)
                // ไม่ต้องเช็ค transaction เดือน เพราะ query กรองไว้แล้ว
                const monthItem = getOrInit(monthMap, prodName, unit);
                if (type === 'ADD') monthItem.received += qty;
                else monthItem.used += Math.abs(qty);

                // วันนี้ (ยึดช่วงเวลาไทย)
                if (inThaiToday) {
                    const item = getOrInit(todayMap, prodName, unit);
                    if (type === 'ADD') item.received += qty;
                    else item.used += Math.abs(qty);
                }
            });

            if (isMounted.current) {
                setGlobalSummary({
                    today: Array.from(todayMap.values()),
                    month: Array.from(monthMap.values())
                });
            }

        } catch (error) {
            console.error("Error:", error);
        } finally {
            if (isMounted.current) setIsLoading(false);
        }

    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => { fetchData(); }, 5000);
        return () => clearInterval(interval);
    }, [fetchData]);

    if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="animate-spin h-10 w-10 border-4 border-indigo-600 rounded-full border-t-transparent"></div></div>;

    // สำหรับแสดงวันที่ในส่วน summary section (แบบไทยในโซน +7 - ไม่ต้องเปลี่ยน logic นี้)
    const displayTodayThai = () => {
        const thaiTime = new Date(Date.now() + (7 * 60 * 60 * 1000));
        return thaiTime.toLocaleDateString('th-TH');
    };

    return (
        <div className="w-full max-w-7xl mx-auto px-4 py-8 space-y-8 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
                <h2 className="text-3xl font-bold text-slate-800">ภาพรวมระบบ</h2>
                <div className="flex flex-row items-center">
                    <button onClick={() => setIsCreateProductOpen(true)} className="flex items-center bg-orange-500 text-white px-5 py-2.5 rounded-xl shadow-lg hover:bg-orange-600 hover:shadow-orange-200 transition transform hover:-translate-y-0.5 font-bold">
                        <span className="text-xl mr-2">+</span> เพิ่มวัตถุดิบใหม่
                    </button>
                    <button onClick={() => setIsDistributionOpen(true)} className="flex items-center bg-purple-600 text-white px-5 py-2.5 rounded-xl shadow-lg hover:bg-purple-700 hover:shadow-purple-200 transition transform hover:-translate-y-0.5 font-bold ml-3">
                        <span className="text-xl mr-2">🏆</span> ดูอันดับสต็อก
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                 <div className="lg:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-slate-100"><MonthlyChart /></div>
                 <div className="lg:col-span-1 h-full">
                    {/* ปรับให้ส่ง onBranchClick ทั้ง id และ name */}
                    <StockAlerts 
                        items={lowStockItems}
                        onBranchClick={(id, name) => handleAlertClick(id, name)} // ส่งทั้ง id และ name
                    />
                 </div>
            </div>

            {/* Summary Section */}
            <div className="bg-indigo-900 rounded-3xl p-8 text-white shadow-xl overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
                <h2 className="text-2xl font-bold mb-6 relative z-10 flex items-center">
                    📊 สรุปยอดการใช้วัตถุดิบรวม (ทุกสาขา)
                    <button onClick={() => { setIsLoading(true); fetchData(); }} className="ml-3 text-xs bg-indigo-700 hover:bg-indigo-600 px-2 py-1 rounded text-indigo-200 transition cursor-pointer">↻ รีเฟรช</button>
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                    {/* วันนี้ */}
                    <div className="bg-white/10 rounded-2xl p-6 backdrop-blur-sm border border-white/10">
                        <div className="flex justify-between items-center mb-4 border-b border-white/20 pb-2">
                            <h3 className="font-bold text-indigo-200">📅 วันนี้ ({displayTodayThai()})</h3>
                            <span className="text-xs bg-indigo-500 px-2 py-1 rounded text-white">Real-time</span>
                        </div>
                        {globalSummary.today.length === 0 ? <p className="text-indigo-300 text-center py-4">วันนี้ยังไม่มีการเคลื่อนไหว</p> : (
                            <ul className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar-dark">
                                {globalSummary.today.map((item, i) => (
                                    <li key={i} className="flex items-center justify-between p-3 bg-indigo-800/40 rounded-xl border border-indigo-700/30 mb-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-8 bg-indigo-500 rounded-full"></div>
                                            <div className="flex flex-col">
                                                <span className="text-white font-bold text-sm">{item.name}</span>
                                                <span className="text-xs text-indigo-300">{item.unit}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] text-indigo-300">คงเหลือ</span>
                                                <span className="text-lg font-mono font-bold text-white">{item.remaining}</span>
                                            </div>
                                            <div className="h-8 w-px bg-indigo-700/50"></div>
                                            <div className="flex flex-col gap-1 w-20">
                                                 {item.received > 0 ? (
                                                     <div className="flex justify-between items-center px-2 py-0.5 rounded bg-green-500/20 border border-green-500/30 text-green-300 text-[10px] font-bold">
                                                        <span>รับ</span><span>+{item.received}</span>
                                                     </div>
                                                 ) : <div className="h-[18px]"></div>}
                                                 {item.used > 0 ? (
                                                     <div className="flex justify-between items-center px-2 py-0.5 rounded bg-red-500/20 border border-red-500/30 text-red-300 text-[10px] font-bold">
                                                        <span>ใช้</span><span>-{item.used}</span>
                                                     </div>
                                                 ) : <div className="h-[18px]"></div>}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* เดือนนี้ */}
                    <div className="bg-white/10 rounded-2xl p-6 backdrop-blur-sm border border-white/10">
                        <div className="flex justify-between items-center mb-4 border-b border-white/20 pb-2">
                            <h3 className="font-bold text-orange-200">🗓️ เดือนนี้</h3>
                            <span className="text-xs bg-orange-600 px-2 py-1 rounded text-white">Accumulated</span>
                        </div>
                        {globalSummary.month.length === 0 ? <p className="text-indigo-300 text-center py-4">เดือนนี้ยังไม่มีการเคลื่อนไหว</p> : (
                            <ul className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar-dark">
                                {globalSummary.month.map((item, i) => (
                                    <li key={i} className="flex items-center justify-between p-3 bg-indigo-800/40 rounded-xl border border-indigo-700/30 mb-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-8 bg-orange-500 rounded-full"></div>
                                            <div className="flex flex-col">
                                                <span className="text-white font-bold text-sm">{item.name}</span>
                                                <span className="text-xs text-indigo-300">{item.unit}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] text-indigo-300">คงเหลือ</span>
                                                <span className="text-lg font-mono font-bold text-white">{item.remaining}</span>
                                            </div>
                                            <div className="h-8 w-px bg-indigo-700/50"></div>
                                            <div className="flex flex-col gap-1 w-20">
                                                 {item.received > 0 ? (
                                                     <div className="flex justify-between items-center px-2 py-0.5 rounded bg-green-500/20 border border-green-500/30 text-green-300 text-[10px] font-bold">
                                                        <span>รับ</span><span>+{item.received}</span>
                                                     </div>
                                                 ) : <div className="h-[18px]"></div>}
                                                 {item.used > 0 ? (
                                                     <div className="flex justify-between items-center px-2 py-0.5 rounded bg-red-500/20 border border-red-500/30 text-red-300 text-[10px] font-bold">
                                                        <span>ใช้</span><span>-{item.used}</span>
                                                     </div>
                                                 ) : <div className="h-[18px]"></div>}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {/* Branch Section */}
            <div className="pt-4">
                <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center">🏪 จัดการสาขา</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {branches.map((branch) => <BranchCard key={branch.id} branch={branch} />)}
                    <button onClick={() => setIsCreateBranchOpen(true)} className="group flex flex-col items-center justify-center h-[200px] rounded-3xl border-2 border-dashed border-slate-300 hover:border-indigo-500 bg-slate-50 hover:bg-indigo-50/50 transition-all cursor-pointer">
                        <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:border-indigo-200 transition-colors shadow-sm mb-3">+</div>
                        <span className="font-semibold text-slate-500 group-hover:text-indigo-600 transition-colors">เพิ่มสาขาใหม่</span>
                    </button>
                </div>
            </div>

            {isCreateBranchOpen && (<CreateBranchModal onClose={() => setIsCreateBranchOpen(false)} onSuccess={() => { setIsLoading(true); fetchData(); }} />)}
            {isCreateProductOpen && (<CreateProductModal onClose={() => setIsCreateProductOpen(false)} onSuccess={() => {}} />)}
            {isDistributionOpen && (<ProductDistributionModal onClose={() => setIsDistributionOpen(false)} />)}
            {/* ตัวอย่าง modal/alert popup เมื่อคลิก item (เตรียมไว้ เผื่อจะขยายในอนาคต) */}
            {/* {alertModalBranchId && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
                    <div className="bg-white rounded-lg p-8 shadow-2xl">
                        <div className="mb-4 font-bold text-lg text-indigo-600">สาขา ID: {alertModalBranchId}</div>
                        <button className="bg-indigo-500 text-white px-6 py-2 rounded" onClick={handleCloseAlertModal}>ปิด</button>
                    </div>
                </div>
            )} */}

            {/* เพิ่ม modal สำหรับแสดงรายละเอียดสาขา */}
            {selectedBranchId && (
                <BranchDetailModal 
                    branchId={selectedBranchId.id}
                    branchName={selectedBranchId.name}
                    onClose={() => setSelectedBranchId(null)}
                />
            )}
        </div>
    );
};

export default Dashboard;