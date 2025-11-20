import React, { useState, useEffect, useCallback } from 'react';

import { supabase } from '../lib/supabase';

import StockActionModal from './StockActionModal';

import { useAuth } from '../context/AuthContext';

// สร้าง Type สำหรับเก็บข้อมูลสรุปแยก รับเข้า/เบิกออก
type SummaryItem = {
    name: string;
    unit: string;
    received: number; // รับเข้า
    used: number;     // ใช้ไป
};

const BranchDetailModal: React.FC<{ branchId: string, branchName: string, onClose: () => void }> = ({ branchId, branchName, onClose }) => {

    const { branch: currentUser } = useAuth();

    const [activeTab, setActiveTab] = useState<'stock' | 'history' | 'summary'>('stock');
    const [stock, setStock] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);

    // State สรุปผลอัปเดตใหม่ เก็บทั้ง received และ used
    const [summary, setSummary] = useState<{ today: SummaryItem[], month: SummaryItem[] }>({ today: [], month: [] });

    const [isLoading, setIsLoading] = useState(true);
    const [isActionModalOpen, setIsActionModalOpen] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);

        // 1. ดึง Stock ล่าสุด
        const { data: stockData } = await supabase.from('stock').select('current_quantity, products(name, unit)').eq('branch_id', branchId);

        // 2. ดึงข้อมูล Transaction เพื่อคำนวณสรุปผล
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0,0,0,0);

        // เอาทั้ง ADD และ REMOVE มาคำนวณ (ลบ .eq('type', 'REMOVE') ออก)
        const { data: txnData } = await supabase
            .from('transactions')
            .select('*, products(name, unit)')
            .eq('branch_id', branchId)
            .gte('created_at', startOfMonth.toISOString());

        // 3. คำนวณสรุปผล แยกรับเข้า/เบิกออก
        const todayStr = new Date().toLocaleDateString('th-TH');

        const todayMap = new Map<string, SummaryItem>();
        const monthMap = new Map<string, SummaryItem>();

        // Helper function เพื่อ init ข้อมูลใน Map
        const getOrInit = (map: Map<string, SummaryItem>, key: string, name: string, unit: string) => {
            if (!map.has(key)) map.set(key, { name, unit, received: 0, used: 0 });
            return map.get(key)!;
        };

        txnData?.forEach((t: any) => {
            const txnDate = new Date(t.created_at).toLocaleDateString('th-TH');
            const prodName = t.products?.name || 'ไม่ระบุชื่อ';
            const unit = t.products?.unit || '';
            const qty = t.quantity_change;
            const type = t.type; // ADD หรือ REMOVE

            // อัปเดตยอดเดือน
            const monthItem = getOrInit(monthMap, prodName, prodName, unit);
            if (type === 'ADD') monthItem.received += qty;
            else monthItem.used += qty;

            // อัปเดตยอดวัน
            if (txnDate === todayStr) {
                const todayItem = getOrInit(todayMap, prodName, prodName, unit);
                if (type === 'ADD') todayItem.received += qty;
                else todayItem.used += qty;
            }
        });

        setStock(stockData || []);

        // 4. ดึง History สำหรับแสดงผล (เลือก products ด้วย)
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
                                    {stock.length === 0 ? <div className="p-8 text-center text-slate-400">ไม่มีข้อมูลสินค้าในสต็อก</div> : (
                                        <table className="w-full">
                                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="px-6 py-3 text-left">สินค้า</th><th className="px-6 py-3 text-right">คงเหลือ</th></tr></thead>
                                            <tbody className="divide-y divide-slate-50">{stock.map((item: any, idx) => (<tr key={idx}><td className="px-6 py-4 font-medium text-slate-800">{item.products?.name}</td><td className="px-6 py-4 text-right"><span className={`px-2 py-1 rounded-md font-bold ${item.current_quantity < 5 ? 'bg-red-100 text-red-600' : 'text-gray-700'}`}>{item.current_quantity} {item.products?.unit}</span></td></tr>))}</tbody>
                                        </table>
                                    )}
                                 </div>
                             )}

                             {/* Tab 2: Summary (ปรับปรุงใหม่ แสดงทั้งรับเข้าและใช้ไป) */}
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
                                                         <li key={idx} className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0">
                                                             <span className="text-slate-700 font-medium">{item.name}</span>
                                                             <div className="flex gap-3 text-sm">
                                                                 {item.received > 0 && <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded">รับ {item.received}</span>}
                                                                 {item.used > 0 && <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded">ใช้ {item.used}</span>}
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
                                                         <li key={idx} className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0">
                                                             <span className="text-slate-700 font-medium">{item.name}</span>
                                                             <div className="flex gap-3 text-sm">
                                                                 {item.received > 0 && <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded">รับ {item.received}</span>}
                                                                 {item.used > 0 && <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded">ใช้ {item.used}</span>}
                                                             </div>
                                                         </li>
                                                     ))}
                                                 </ul>
                                             )}
                                         </div>
                                     </div>
                                 </div>
                             )}

                             {/* Tab 3: History (ปรับปรุงใหม่ แสดงชื่อสินค้า) */}
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
                                                                {/* เพิ่มชื่อสินค้าตรงนี้ !! */}
                                                                <span className="text-indigo-600 ml-2">
                                                                    {txn.products?.name}
                                                                </span>
                                                            </p>
                                                            <p className="text-xs text-slate-400">
                                                                {new Date(txn.created_at).toLocaleString('th-TH')} โดย {txn.performed_by}
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