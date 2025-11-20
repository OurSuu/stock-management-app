import React, { useState, useEffect, useCallback } from 'react';

import { supabase } from '../lib/supabase';

import StockActionModal from './StockActionModal';

import { useAuth } from '../context/AuthContext';

// --- Types ---
type SummaryItem = { name: string; unit: string; received: number; used: number; remaining: number; };
type ProductOption = { id: string; name: string; }; // Type สำหรับ Dropdown

// Util: แปลงเวลา UTC เป็นเวลาไทย
function toThailandTime(dateStr: string) {
    // Supabase จะ return เป็น ISO string ที่เป็น UTC time
    const date = new Date(dateStr);
    // เพิ่ม offset +7 ชั่วโมงให้แปลงเป็นเวลาประเทศไทย
    return new Date(date.getTime() + 7 * 60 * 60 * 1000);
}

const BranchDetailModal: React.FC<{ branchId: string, branchName: string, onClose: () => void }> = ({ branchId, branchName, onClose }) => {

    const { branch: currentUser } = useAuth();

    const [activeTab, setActiveTab] = useState<'stock' | 'history' | 'summary'>('stock');
    const [stock, setStock] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [summary, setSummary] = useState<{ today: SummaryItem[], month: SummaryItem[] }>({ today: [], month: [] });

    // --- State สำหรับตัวกรอง ---
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    const [filterProductId, setFilterProductId] = useState<string>('');

    const [isLoading, setIsLoading] = useState(true);
    const [isActionModalOpen, setIsActionModalOpen] = useState(false);

    // โหลดรายชื่อสินค้าทั้งหมดมาใส่ Dropdown
    useEffect(() => {
        const fetchProducts = async () => {
            const { data } = await supabase.from('products').select('id, name').order('name');
            if (data) setAllProducts(data);
        };
        fetchProducts();
    }, []);

    const fetchData = useCallback(async () => {
        setIsLoading(true);

        // 1. ดึง Stock ล่าสุด (เพิ่ม product_id มาด้วยเพื่อใช้กรอง)
        const { data: stockData } = await supabase
            .from('stock')
            .select('current_quantity, product_id, products(name, unit)')
            .eq('branch_id', branchId);

        const remainingMap = new Map<string, number>();
        stockData?.forEach((item: any) => {
            const name = item.products?.name || 'Unknown';
            remainingMap.set(name, item.current_quantity);
        });

        // 2. ดึง Transaction (ใช้ startOfMonth เป็นเวลาประเทศไทย)
        const thNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const startOfMonthTh = new Date(
            thNow.getFullYear(),
            thNow.getMonth(),
            1, 0, 0, 0, 0
        );
        // ย้อนกลับมา UTC ISO string เพื่อ query Supabase
        const startOfMonthUTC = new Date(startOfMonthTh.getTime() - 7 * 60 * 60 * 1000).toISOString();

        const { data: txnData } = await supabase
            .from('transactions')
            .select('*, products(name, unit)')
            .eq('branch_id', branchId)
            .gte('created_at', startOfMonthUTC);

        // 3. คำนวณสรุปผล
        // นิยามวันนี้/เดือนนี้เป็นเวลาประเทศไทย
        const thailandNow = new Date(Date.now() + 7 * 60 * 60 * 1000);

        const todayTh = new Date(
            thailandNow.getFullYear(),
            thailandNow.getMonth(),
            thailandNow.getDate(), 0, 0, 0, 0
        );
        // Removed unused variable endOfTodayTh
        const todayDateStr = todayTh.toLocaleDateString('th-TH');
        const currentMonthStrTh = thailandNow.toLocaleDateString('th-TH', { month: 'numeric', year: 'numeric' });

        const todayMap = new Map<string, SummaryItem>();
        const monthMap = new Map<string, SummaryItem>();

        const getOrInit = (map: Map<string, SummaryItem>, name: string, unit: string) => {
            if (!map.has(name)) {
                map.set(name, {
                    name,
                    unit,
                    received: 0,
                    used: 0,
                    remaining: remainingMap.get(name) || 0
                });
            }
            return map.get(name)!;
        };

        txnData?.forEach((t: any) => {
            // แปลง created_at เป็นเวลาไทย
            const txnDateTh = toThailandTime(t.created_at);
            const txnDateStr = txnDateTh.toLocaleDateString('th-TH');
            const txnMonthStr = txnDateTh.toLocaleDateString('th-TH', { month: 'numeric', year: 'numeric' });

            const prodName = t.products?.name || 'ไม่ระบุชื่อ';
            const unit = t.products?.unit || '';
            const qty = t.quantity_change;
            const type = t.type;

            // ยอดเดือน (เวลาไทย)
            if (txnMonthStr === currentMonthStrTh) {
                const item = getOrInit(monthMap, prodName, unit);
                if (type === 'ADD') item.received += qty;
                else item.used += Math.abs(qty);
            }

            // ยอดวัน (เวลาไทย)
            if (txnDateStr === todayDateStr) {
                const item = getOrInit(todayMap, prodName, unit);
                if (type === 'ADD') item.received += qty;
                else item.used += Math.abs(qty);
            }
        });

        setStock(stockData || []);

        const { data: recentHistory } = await supabase
            .from('transactions')
            .select('*, products(name, unit)')
            .eq('branch_id', branchId)
            .order('created_at', { ascending: false })
            .limit(20);

        setHistory(recentHistory || []);

        setSummary({
            today: Array.from(todayMap.values()),
            month: Array.from(monthMap.values())
        });

        setIsLoading(false);
    }, [branchId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // --- Logic กรองข้อมูล ---
    const displayedStock = filterProductId
        ? stock.filter(item => item.product_id === filterProductId)
        : stock;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[90vh] animate-slide-up">

                {/* Header */}
                <div className="bg-white border-b border-slate-100 p-6 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">{branchName}</h2>
                        <p className="text-sm text-slate-500">รหัสสาขา: #{branchId.substring(0, 6)}</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 text-xl">✕</button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
                    {/* Tabs */}
                    <div className="flex space-x-2 mb-6 bg-white p-1.5 rounded-xl shadow-sm w-fit mx-auto overflow-x-auto max-w-full">
                        <button onClick={() => setActiveTab('stock')} className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${activeTab === 'stock' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📦 สต็อกสินค้า</button>
                        <button onClick={() => setActiveTab('summary')} className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${activeTab === 'summary' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📊 สรุปผลการใช้</button>
                        <button onClick={() => setActiveTab('history')} className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${activeTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📜 ประวัติรายการ</button>
                    </div>

                    {isLoading ? (
                        <div className="py-20 text-center"><div className="animate-spin h-10 w-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto"></div></div>
                    ) : (
                        <div className="space-y-4">
                            {/* Tab 1: Stock */}
                            {activeTab === 'stock' && (
                                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">

                                    {/* ✨ ส่วนตัวกรอง (เพิ่มใหม่ตรงนี้) ✨ */}
                                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-2 w-full sm:w-auto">
                                            <span className="text-sm font-bold text-slate-500">🔍 กรอง:</span>
                                            <select
                                                value={filterProductId}
                                                onChange={(e) => setFilterProductId(e.target.value)}
                                                className="p-2 pl-3 pr-8 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm w-full sm:w-48 cursor-pointer"
                                            >
                                                <option value="">ทั้งหมด</option>
                                                {allProducts.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {filterProductId && (
                                            <button onClick={() => setFilterProductId('')} className="text-xs text-indigo-600 hover:underline font-bold">ล้างค่า</button>
                                        )}
                                    </div>

                                    {displayedStock.length === 0 ? (
                                        <div className="p-8 text-center text-slate-400">
                                            {filterProductId ? 'ไม่พบสินค้านี้ในสต็อก' : 'ไม่มีข้อมูลสินค้าในสต็อก'}
                                        </div>
                                    ) : (
                                        <table className="w-full">
                                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="px-6 py-3 text-left">สินค้า</th><th className="px-6 py-3 text-right">คงเหลือ</th></tr></thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {displayedStock.map((item: any, idx) => (
                                                    <tr key={idx}>
                                                        <td className="px-6 py-4 font-medium text-slate-800">{item.products?.name}</td>
                                                        <td className="px-6 py-4 text-right">
                                                            <span className={`px-2 py-1 rounded-md font-bold ${item.current_quantity < 5 ? 'bg-red-100 text-red-600' : 'text-gray-700'}`}>
                                                                {item.current_quantity} {item.products?.unit}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                 </div>
                             )}

                             {/* Tab 2: Summary (ดีไซน์ใหม่ แยกคงเหลือ) */}
                             {activeTab === 'summary' && (
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                     {/* รายวัน */}
                                     <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden">
                                         <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex items-center justify-between">
                                             <h3 className="font-bold text-indigo-700">📅 วันนี้ ({new Date().toLocaleDateString('th-TH')})</h3>
                                         </div>
                                         <div className="p-4">
                                             {summary.today.length === 0 ? (
                                                 <div className="text-center text-slate-400 py-6">วันนี้ยังไม่มีรายการ</div>
                                             ) : (
                                                 <ul className="space-y-3">
                                                     {summary.today.map((item, idx) => (
                                                         <li key={idx} className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0 hover:bg-slate-50 transition px-2 rounded-lg">
                                                             <div className="flex flex-col">
                                                                 <span className="text-slate-700 font-bold">{item.name}</span>
                                                                 <span className="text-xs text-slate-400 font-light">หน่วย: {item.unit}</span>
                                                             </div>
                                                             <div className="flex items-center gap-3">
                                                                 <div className="flex flex-col items-end mr-2 border-r border-slate-200 pr-3">
                                                                     <span className="text-[10px] text-slate-400 uppercase tracking-wider">คงเหลือ</span>
                                                                     <span className="font-mono text-lg font-bold text-slate-700">{item.remaining}</span>
                                                                 </div>
                                                                 <div className="flex flex-col gap-1 min-w-[70px]">
                                                                    <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${item.received > 0 ? 'bg-green-100 text-green-700' : 'opacity-0'}`}><span>รับ</span><span>+{item.received}</span></div>
                                                                    <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${item.used > 0 ? 'bg-red-100 text-red-700' : 'opacity-0'}`}><span>ใช้</span><span>-{item.used}</span></div>
                                                                 </div>
                                                             </div>
                                                         </li>
                                                     ))}
                                                 </ul>
                                             )}
                                         </div>
                                     </div>

                                     {/* รายเดือน */}
                                     <div className="bg-white rounded-2xl shadow-sm border border-orange-100 overflow-hidden">
                                         <div className="bg-orange-50 p-4 border-b border-orange-100 flex items-center justify-between">
                                             <h3 className="font-bold text-orange-700">🗓️ เดือนนี้</h3>
                                         </div>
                                         <div className="p-4">
                                             {summary.month.length === 0 ? (
                                                 <div className="text-center text-slate-400 py-6">เดือนนี้ยังไม่มีรายการ</div>
                                             ) : (
                                                 <ul className="space-y-3">
                                                     {summary.month.map((item, idx) => (
                                                         <li key={idx} className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0 hover:bg-slate-50 transition px-2 rounded-lg">
                                                             <div className="flex flex-col">
                                                                 <span className="text-slate-700 font-bold">{item.name}</span>
                                                                 <span className="text-xs text-slate-400 font-light">หน่วย: {item.unit}</span>
                                                             </div>
                                                             <div className="flex items-center gap-3">
                                                                 <div className="flex flex-col items-end mr-2 border-r border-slate-200 pr-3">
                                                                     <span className="text-[10px] text-slate-400 uppercase tracking-wider">คงเหลือ</span>
                                                                     <span className="font-mono text-lg font-bold text-slate-700">{item.remaining}</span>
                                                                 </div>
                                                                 <div className="flex flex-col gap-1 min-w-[70px]">
                                                                    <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${item.received > 0 ? 'bg-green-100 text-green-700' : 'opacity-0'}`}><span>รับ</span><span>+{item.received}</span></div>
                                                                    <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${item.used > 0 ? 'bg-red-100 text-red-700' : 'opacity-0'}`}><span>ใช้</span><span>-{item.used}</span></div>
                                                                 </div>
                                                             </div>
                                                         </li>
                                                     ))}
                                                 </ul>
                                             )}
                                         </div>
                                     </div>
                                 </div>
                             )}

                             {/* Tab 3: History (มีชื่อสินค้า) */}
                             {activeTab === 'history' && (
                                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                                    {history.length === 0 ? <div className="p-8 text-center text-slate-400">ไม่มีประวัติ</div> : (
                                        <div className="divide-y divide-slate-50">
                                            {history.map((txn: any) => (
                                                <div key={txn.id} className="flex justify-between items-center p-4 px-6 hover:bg-slate-50 transition">
                                                    <div className="flex items-center">
                                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-4 ${txn.type === 'ADD' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                                            {txn.type === 'ADD' ? '📥' : '📤'}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-slate-800">
                                                                {txn.type === 'ADD' ? 'รับของเข้า' : 'เบิกของออก'} 
                                                                <span className="text-indigo-600 ml-2">{txn.products?.name}</span>
                                                            </p>
                                                            <p className="text-xs text-slate-400">
                                                                {toThailandTime(txn.created_at).toLocaleString('th-TH')} โดย {txn.performed_by}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <span className={`font-bold text-lg ${txn.type === 'ADD' ? 'text-green-600' : 'text-red-600'}`}>
                                                        {txn.type === 'ADD' ? '+' : '-'}{txn.quantity_change} {txn.products?.unit}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                             )}
                        </div>
                    )}
                </div>
                
                {/* Footer Actions */}
                <div className="p-4 bg-white border-t border-slate-100 flex justify-end space-x-3 shrink-0">
                    <button className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200" onClick={onClose}>ปิดหน้าต่าง</button>
                    <button 
                        className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold shadow-lg hover:bg-indigo-700 hover:-translate-y-0.5 transition-all"
                        onClick={() => setIsActionModalOpen(true)}
                    >
                        + บันทึกรับเข้า/เบิกออก
                    </button>
                </div>
            </div>

            {isActionModalOpen && (
                <StockActionModal 
                    branchId={branchId} 
                    loginCode={currentUser?.login_code || 'admin'}
                    onClose={() => setIsActionModalOpen(false)}
                    onSuccess={() => { fetchData(); }}
                />
            )}
        </div>
    );
};

export default BranchDetailModal;