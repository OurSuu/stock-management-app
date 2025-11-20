import React, { useState, useEffect, useCallback, useRef } from 'react';

import { supabase } from '../lib/supabase';

import MonthlyChart from '../components/MonthlyChart';
import BranchCard from '../components/BranchCard';
import StockAlerts from '../components/StockAlerts'; // เอา { LowStockItem } ออก
import CreateBranchModal from '../components/CreateBranchModal';
import CreateProductModal from '../components/CreateProductModal';

type BranchSummary = { id: string; branch_name: string; status: 'good' | 'warning' | 'critical'; total_stock_value: number; };
type UsageSummary = { name: string; unit: string; received: number; used: number; };

// Define LowStockItem type inline, since it's not imported anymore
type LowStockItem = {
    id: string;
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

    // ใช้ Ref เพื่อป้องกันการอัปเดต State หลังจาก Component ถูกถอดออก (แก้ Error Memory Leak)
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const fetchData = useCallback(async () => {
        try {
            // 1. ดึงข้อมูลสาขา
            const { data: branchData } = await supabase.from('branches').select('*').order('branch_name');

            // 2. ดึงข้อมูล Stock ทั้งหมด (เพื่อคำนวณ Alerts และ Status)
            const { data: allStock } = await supabase
                .from('stock')
                .select('id, current_quantity, products(name, min_alert_quantity, unit), branches(id, branch_name)');

            // --- ส่วนคำนวณ Alerts ---
            const alerts: LowStockItem[] = [];
            const branchStatusMap = new Map<string, 'good' | 'warning' | 'critical'>();

            allStock?.forEach((item: any) => {
                const qty = item.current_quantity;
                const min = item.products?.min_alert_quantity || 0;
                const branchId = item.branches?.id;

                // เงื่อนไขแจ้งเตือน: ถ้าน้อยกว่าหรือเท่ากับเกณฑ์
                if (qty <= min) {
                    alerts.push({
                        id: item.id,
                        branch_name: item.branches?.branch_name || 'ไม่ระบุ',
                        product_name: item.products?.name || 'สินค้า',
                        current_quantity: qty,
                        min_alert: min,
                        unit: item.products?.unit || ''
                    });

                    // อัปเดตสถานะสาขา (ถ้ามีของหมด = critical, ถ้าแค่ใกล้หมด = warning)
                    const currentStatus = branchStatusMap.get(branchId) || 'good';
                    if (qty === 0) branchStatusMap.set(branchId, 'critical');
                    else if (currentStatus !== 'critical') branchStatusMap.set(branchId, 'warning');
                }
            });

            if (isMounted.current) {

                setLowStockItems(alerts); // อัปเดตรายการแจ้งเตือน

                // อัปเดตข้อมูลสาขา
                const mappedBranches: BranchSummary[] = (branchData || []).map((b: any) => ({
                    ...b,
                    status: branchStatusMap.get(b.id) || 'good',
                    total_stock_value: 0
                }));
                setBranches(mappedBranches);
            }

            // 3. ดึงข้อมูล Transaction (เพื่อคำนวณยอดรวม)
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const { data: txnData } = await supabase
                .from('transactions')
                .select('*, products(name, unit)')
                .gte('created_at', startOfMonth.toISOString());

            // --- ส่วนคำนวณยอดสรุป (ใช้ String Comparison แบบไทย แม่นยำกว่า) ---
            const todayStr = new Date().toLocaleDateString('th-TH'); 
            const todayMap = new Map<string, UsageSummary>();
            const monthMap = new Map<string, UsageSummary>();

            const getOrInit = (map: Map<string, UsageSummary>, key: string, name: string, unit: string) => {
                if (!map.has(key)) map.set(key, { name, unit, received: 0, used: 0 });
                return map.get(key)!;
            };

            txnData?.forEach((t: any) => {
                const txnDate = new Date(t.created_at).toLocaleDateString('th-TH');
                const prodName = t.products?.name || 'สินค้าไม่ระบุชื่อ';
                const unit = t.products?.unit || '';
                const qty = t.quantity_change;
                const type = t.type;

                // ยอดเดือน
                const monthItem = getOrInit(monthMap, prodName, prodName, unit);
                if (type === 'ADD') monthItem.received += qty;
                else monthItem.used += Math.abs(qty); // ใช้ Math.abs เผื่อค่ามาติดลบ

                // ยอดวัน
                if (txnDate === todayStr) {
                    const todayItem = getOrInit(todayMap, prodName, prodName, unit);
                    if (type === 'ADD') todayItem.received += qty;
                    else todayItem.used += Math.abs(qty);
                }
            });

            if (isMounted.current) {
                setGlobalSummary({
                    today: Array.from(todayMap.values()),
                    month: Array.from(monthMap.values())
                });
            }

        } catch (error) {
            console.error("Error fetching dashboard data:", error);
        } finally {
            if (isMounted.current) setIsLoading(false); // หยุดโหลดเมื่อเสร็จสิ้น
        }

    }, []);

    // useEffect สำหรับโหลดข้อมูลและ Auto Refresh
    useEffect(() => {
        fetchData(); // โหลดครั้งแรกทันที

        const interval = setInterval(() => {
            // เรียก fetchData แบบเงียบๆ (ไม่สั่ง setIsLoading(true) อีก)
            fetchData();
        }, 5000); // รีเฟรชทุก 5 วินาที

        return () => clearInterval(interval);
    }, [fetchData]);

    if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="animate-spin h-10 w-10 border-4 border-indigo-600 rounded-full border-t-transparent"></div></div>;

    return (
        <div className="w-full max-w-7xl mx-auto px-4 py-8 space-y-8 animate-fade-in">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
                <h2 className="text-3xl font-bold text-slate-800">ภาพรวมระบบ</h2>
                <button onClick={() => setIsCreateProductOpen(true)} className="flex items-center bg-orange-500 text-white px-5 py-2.5 rounded-xl shadow-lg hover:bg-orange-600 hover:shadow-orange-200 transition transform hover:-translate-y-0.5 font-bold">
                    <span className="text-xl mr-2">+</span> เพิ่มวัตถุดิบใหม่
                </button>
            </div>
            
            {/* Charts & Alerts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-slate-100"><MonthlyChart /></div>
                <div className="lg:col-span-1 h-full"><StockAlerts items={lowStockItems} /></div>
            </div>

            {/* Global Summary Section */}
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
                            <h3 className="font-bold text-indigo-200">📅 วันนี้ ({new Date().toLocaleDateString('th-TH')})</h3>
                            <span className="text-xs bg-indigo-500 px-2 py-1 rounded text-white">Real-time</span>
                        </div>
                        {globalSummary.today.length === 0 ? <p className="text-indigo-300 text-center py-4">วันนี้ยังไม่มีการเคลื่อนไหว</p> : (
                            <ul className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar-dark">
                                {globalSummary.today.map((item, i) => (
                                    <li key={i} className="flex justify-between text-sm items-center bg-indigo-800/30 p-3 rounded-lg">
                                        <span className="font-medium">{item.name}</span>
                                        <div className="flex gap-2 text-xs font-bold">
                                            {item.received > 0 && <span className="text-green-300 bg-green-900/30 px-2 py-1 rounded">รับ {item.received}</span>}
                                            {item.used > 0 && <span className="text-red-300 bg-red-900/30 px-2 py-1 rounded">ใช้ {item.used}</span>}
                                            <span className="text-gray-400 self-center ml-1">{item.unit}</span>
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
                                    <li key={i} className="flex justify-between text-sm items-center bg-indigo-800/30 p-3 rounded-lg">
                                        <span className="font-medium">{item.name}</span>
                                        <div className="flex gap-2 text-xs font-bold">
                                            {item.received > 0 && <span className="text-green-300 bg-green-900/30 px-2 py-1 rounded">รับ {item.received}</span>}
                                            {item.used > 0 && <span className="text-red-300 bg-red-900/30 px-2 py-1 rounded">ใช้ {item.used}</span>}
                                            <span className="text-gray-400 self-center ml-1">{item.unit}</span>
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

        </div>
    );
};

export default Dashboard;