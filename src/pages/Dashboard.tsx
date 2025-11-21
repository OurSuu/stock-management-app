import React, { useState, useEffect, useCallback, useRef } from 'react';

import { supabase } from '../lib/supabase';

import MonthlyChart from '../components/MonthlyChart';
import BranchCard from '../components/BranchCard';
import StockAlerts from '../components/StockAlerts';
import CreateBranchModal from '../components/CreateBranchModal';
import CreateProductModal from '../components/CreateProductModal';
import ProductDistributionModal from '../components/ProductDistributionModal';
import BranchDetailModal from '../components/BranchDetailModal';

type BranchSummary = { id: string; branch_name: string; status: 'good' | 'warning' | 'critical'; total_stock_value: number; };
type UsageSummary = { name: string; unit: string; received: number; used: number; remaining: number; };

import type { LowStockItem as StockAlertLowStockItem } from '../components/StockAlerts';

const Dashboard: React.FC = () => {

    const [branches, setBranches] = useState<BranchSummary[]>([]);
    const [globalSummary, setGlobalSummary] = useState<{ today: UsageSummary[], month: UsageSummary[] }>({ today: [], month: [] });
    const [lowStockItems, setLowStockItems] = useState<StockAlertLowStockItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false);
    const [isCreateProductOpen, setIsCreateProductOpen] = useState(false);
    const [isDistributionOpen, setIsDistributionOpen] = useState(false);

    const [selectedBranchId, setSelectedBranchId] = useState<{id: string, name: string} | null>(null);

    const handleAlertClick = (branchId: string, branchName: string) => {
        if (!branchId) return;
        setSelectedBranchId({ id: branchId, name: branchName });
    };

    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    // ช่วยฟังก์ชันสร้างช่วงเวลาเป็น ISO string ของ "วันนี้" (0:00-0:00 วันถัดไป) ตามเวลาประเทศไทย (UTC+7)
    const getTodayThaiMidnightRange = () => {
        const now = new Date();
        // เวลาไทยจริงๆ
        const nowInBangkok = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
        nowInBangkok.setHours(0, 0, 0, 0);
        // ตอน 0:00 วันนี้
        const todayStartBangkok = new Date(nowInBangkok);
        // ตอน 0:00 วันถัดไป
        const tomorrow = new Date(todayStartBangkok);
        tomorrow.setDate(todayStartBangkok.getDate() + 1);

        // กลับไปหาเวลา UTC ที่ตรงกับ 0:00 ไทย และ 0:00 ไทยวันถัดไป (ขอเป็น ISO ของ UTC)
        const start = new Date(todayStartBangkok.getTime() - (todayStartBangkok.getTimezoneOffset() * 60000)).toISOString();
        const end = new Date(tomorrow.getTime() - (tomorrow.getTimezoneOffset() * 60000)).toISOString();

        return { start, end };
    };

    // คืนช่วงต้นเดือน-ต้นเดือนถัดไป ตามเวลาประเทศไทยเหมือนกัน
    const getThisThaiMonthRange = () => {
        const now = new Date();
        const nowInBangkok = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
        // set เป็นวันแรกของเดือน
        nowInBangkok.setDate(1);
        nowInBangkok.setHours(0, 0, 0, 0);

        const monthStart = new Date(nowInBangkok);
        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthStart.getMonth() + 1);

        // กลับ timeUTC ของไทย (ใช้ for query)
        const start = new Date(monthStart.getTime() - (monthStart.getTimezoneOffset() * 60000)).toISOString();
        const end = new Date(monthEnd.getTime() - (monthEnd.getTimezoneOffset() * 60000)).toISOString();
        return { start, end };
    };

    const fetchData = useCallback(async () => {
        try {
            // 1. ข้อมูลสาขา
            const { data: branchData } = await supabase.from('branches').select('*').order('branch_name');

            // 2. ข้อมูล stock และข้อมูลสินค้า/unit
            const { data: allStock } = await supabase
                .from('stock')
                .select('id, current_quantity, products(name, min_alert_quantity, unit), branches(id, branch_name)');

            // Map สำหรับสถานะ/alarm ของสาขา + รวมคงเหลือราย product
            const alerts: StockAlertLowStockItem[] = [];
            const branchStatusMap = new Map<string, 'good' | 'warning' | 'critical'>();
            const productRemainingMap = new Map<string, number>();

            allStock?.forEach((item: any) => {
                const qty = item.current_quantity;
                const min = item.products?.min_alert_quantity || 0;
                const branchId = item.branches?.id || '';
                const prodName = item.products?.name || 'Unknown';

                const currentTotal = productRemainingMap.get(prodName) ?? 0;
                productRemainingMap.set(prodName, currentTotal + qty);

                if (qty <= min) {
                    alerts.push({
                        id: item.id,
                        branch_id: branchId,
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

            // ===== เงื่อนไขเวลาไทย เพื่อ filter รายการ txn รายวัน/เดือน =====
            const { start: thaiMidnightStart, end: thaiMidnightEnd } = getTodayThaiMidnightRange();
            const { start: thaiMonthStart, end: thaiMonthEnd } = getThisThaiMonthRange();

            // Query สำหรับช่วงเดือนไทย (และใช้ determine ว่าธุรกรรมในวันไทยไหม)
            const { data: txnData } = await supabase
                .from('transactions')
                .select('*, products(name, unit)')
                .gte('created_at', thaiMonthStart)
                .lt('created_at', thaiMonthEnd);

            // ===== เตรียม product master (ชื่อสินค้า+unit) =====
            const allProdNamesWithUnit = new Map<string, { unit: string }>();
            allStock?.forEach((item: any) => {
                const prodName = item.products?.name || 'Unknown';
                const unit = item.products?.unit || '';
                if (!allProdNamesWithUnit.has(prodName)) {
                    allProdNamesWithUnit.set(prodName, { unit });
                }
            });

            // === (1) รวมธุรกรรม "รายวัน/เดือน" แบบไทย  ===
            // เปลี่ยน logic โดยนับ ADD ทั้งหมดในเดือน/วัน ของทุก branch ให้รวม
            // และนับ USED ทั้งหมดเช่นกัน เพื่อให้ยอดรับเข้า "รวมรับ" ถูกต้อง

            type TxnAgg = { received: number; used: number; };

            // เก็บ summary ต่อชื่อวัตถุดิบ-หน่วย
            const monthAggMap = new Map<string, TxnAgg>();
            const todayAggMap = new Map<string, TxnAgg>();

            // Helper สำหรับ key
            const prodKey = (name: string, unit: string) => `${name}###${unit}`;

            txnData?.forEach((t: any) => {
                const createdAtUTC = t.created_at;
                const prodName = t.products?.name || 'สินค้าไม่ระบุชื่อ';
                const unit = t.products?.unit || '';
                const qty = t.quantity_change;
                const type = t.type;

                // เดือน: สะสมรับและใช้
                const monthK = prodKey(prodName, unit);
                const monthVal = monthAggMap.get(monthK) || { received: 0, used: 0 };
                if (type === 'ADD') monthVal.received += qty;
                else monthVal.used += Math.abs(qty);
                monthAggMap.set(monthK, monthVal);

                // วัน: ต้องอยู่ในช่วงวันไทยด้วย
                const inThaiToday = (createdAtUTC >= thaiMidnightStart && createdAtUTC < thaiMidnightEnd);
                if (inThaiToday) {
                    const todayK = prodKey(prodName, unit);
                    const todayVal = todayAggMap.get(todayK) || { received: 0, used: 0 };
                    if (type === 'ADD') todayVal.received += qty;
                    else todayVal.used += Math.abs(qty);
                    todayAggMap.set(todayK, todayVal);
                }
            });

            // (1.1) เตรียมคงเหลือรวมของแต่ละ product
            const productRemainingByKey = new Map<string, number>();
            allProdNamesWithUnit.forEach(({unit}, name) => {
                const key = prodKey(name, unit);
                productRemainingByKey.set(key, productRemainingMap.get(name) || 0);
            });

            // (2) สร้าง UsageSummary ของเดือน
            const monthSummaries: UsageSummary[] = [];
            allProdNamesWithUnit.forEach(({ unit }, name) => {
                const key = prodKey(name, unit);
                const agg = monthAggMap.get(key) || { received: 0, used: 0 };
                monthSummaries.push({
                    name,
                    unit,
                    received: agg.received,
                    used: agg.used,
                    remaining: productRemainingByKey.get(key) || 0
                });
            });

            // (3) สร้าง UsageSummary ของวัน
            const todaySummaries: UsageSummary[] = [];
            allProdNamesWithUnit.forEach(({ unit }, name) => {
                const key = prodKey(name, unit);
                const agg = todayAggMap.get(key) || { received: 0, used: 0 };
                todaySummaries.push({
                    name,
                    unit,
                    received: agg.received,
                    used: agg.used,
                    remaining: productRemainingByKey.get(key) || 0
                });
            });

            if (isMounted.current) {
                setGlobalSummary({
                    today: todaySummaries,
                    month: monthSummaries
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

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin h-10 w-10 border-4 border-indigo-600 rounded-full border-t-transparent"></div>
            </div>
        );
    }

    // สำหรับแสดงวันที่ปัจจุบัน (แบบไทย, เขต Bangkok)
    const displayTodayThai = () => {
        const now = new Date();
        return new Intl.DateTimeFormat('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }).format(now);
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
                    <StockAlerts
                        items={lowStockItems}
                        onBranchClick={(id, name) => handleAlertClick(id, name)}
                    />
                </div>
            </div>

            {/* สรุปผลรวมวัตถุดิบทุกสาขา */}
            <div className="bg-indigo-900 rounded-3xl p-8 text-white shadow-xl overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
                <h2 className="text-2xl font-bold mb-6 relative z-10 flex items-center">
                    📊 สรุปยอดการใช้วัตถุดิบรวม (ทุกสาขา)
                    <button onClick={() => { setIsLoading(true); fetchData(); }} className="ml-3 text-xs bg-indigo-700 hover:bg-indigo-600 px-2 py-1 rounded text-indigo-200 transition cursor-pointer">↻ รีเฟรช</button>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                    {/* รายวัน */}
                    <div className="bg-white/10 rounded-2xl p-6 backdrop-blur-sm border border-white/10">
                        <div className="flex justify-between items-center mb-4 border-b border-white/20 pb-2">
                            <h3 className="font-bold text-indigo-200">📅 วันนี้ ({displayTodayThai()})</h3>
                            <span className="text-xs bg-indigo-500 px-2 py-1 rounded text-white">Real-time</span>
                        </div>
                        {globalSummary.today.length === 0 ? (
                            <p className="text-indigo-300 text-center py-4">วันนี้ยังไม่มีการเคลื่อนไหว</p>
                        ) : (
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
                                                <div className="flex justify-between items-center px-2 py-0.5 rounded bg-green-500/20 border border-green-500/30 text-green-300 text-[10px] font-bold">
                                                    <span>รับ</span>
                                                    <span>
                                                        {item.received > 0 ? "+" + item.received : "0"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center px-2 py-0.5 rounded bg-red-500/20 border border-red-500/30 text-red-300 text-[10px] font-bold mt-1">
                                                    <span>ใช้</span>
                                                    <span>
                                                        {item.used > 0 ? "-" + item.used : "0"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    {/* รายเดือน */}
                    <div className="bg-white/10 rounded-2xl p-6 backdrop-blur-sm border border-white/10">
                        <div className="flex justify-between items-center mb-4 border-b border-white/20 pb-2">
                            <h3 className="font-bold text-orange-200">🗓️ เดือนนี้</h3>
                            <span className="text-xs bg-orange-600 px-2 py-1 rounded text-white">Accumulated</span>
                        </div>
                        {globalSummary.month.length === 0 ? (
                            <p className="text-indigo-300 text-center py-4">เดือนนี้ยังไม่มีการเคลื่อนไหว</p>
                        ) : (
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
                                                <div className="flex justify-between items-center px-2 py-0.5 rounded bg-green-500/20 border border-green-500/30 text-green-300 text-[10px] font-bold">
                                                    <span>รับ</span>
                                                    <span>
                                                        {item.received > 0 ? "+" + item.received : "0"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center px-2 py-0.5 rounded bg-red-500/20 border border-red-500/30 text-red-300 text-[10px] font-bold mt-1">
                                                    <span>ใช้</span>
                                                    <span>
                                                        {item.used > 0 ? "-" + item.used : "0"}
                                                    </span>
                                                </div>
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