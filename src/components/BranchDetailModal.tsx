import React, { useState, useEffect, useCallback } from 'react';

import { supabase } from '../lib/supabase';

type SummaryItem = { name: string; unit: string; received: number; used: number; remaining: number; };

const BranchDetailModal: React.FC<{ branchId: string; branchName: string; onClose: () => void }> = ({
    branchId,
    branchName,
    onClose,
}) => {
    const [activeTab, setActiveTab] = useState<'stock' | 'branchsummary' | 'history' | 'summary'>('branchsummary');
    const [stock, setStock] = useState<any[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [summary, setSummary] = useState<{ today: SummaryItem[]; month: SummaryItem[] }>({ today: [], month: [] });
    const [branchSummary, setBranchSummary] = useState<{
        in_count: number;
        out_count: number;
        net_count: number;
        products_count: number;
    }>({ in_count: 0, out_count: 0, net_count: 0, products_count: 0 });

    const [delivering, setDelivering] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // State สำหรับค้นหาในหน้าประวัติ
    const [historySearch, setHistorySearch] = useState('');

    // ฟังก์ชันแปลงวันเวลาเป็นโซนไทย
    const toThaiDate = (d: string | Date) => {
        return new Date(d).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
    };
    const toThaiDateTime = (d: string | Date) => {
        return new Date(d).toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            hour: '2-digit',
            minute: '2-digit',
        });
    };
    const toThaiDateDayFull = (d: string | Date) => {
        return new Date(d).toLocaleDateString('th-TH', {
            timeZone: 'Asia/Bangkok',
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    };

    const fetchData = useCallback(async () => {
        setIsLoading(true);

        // 1. ดึง Stock ล่าสุด
        const { data: stockData } = await supabase
            .from('stock')
            .select('current_quantity, products(name, unit)')
            .eq('branch_id', branchId);

        // เก็บ Map สำหรับยอดคงเหลือ (เอาไว้โชว์ใน Summary)
        const remainingMap = new Map<string, number>();
        stockData?.forEach((item: any) => {
            remainingMap.set(item.products?.name || '', item.current_quantity);
        });

        // 2. ดึง Transaction (ใช้สำหรับทั้ง Summary และ History Tab)
        // ดึงย้อนหลัง 60 วันเพื่อให้เห็นประวัติเยอะหน่อย
        const historyLimitDate = new Date();
        historyLimitDate.setDate(historyLimitDate.getDate() - 60);

        const { data: txnData } = await supabase
            .from('transactions')
            .select('*, products(name, unit)')
            .eq('branch_id', branchId)
            .gte('created_at', historyLimitDate.toISOString())
            .order('created_at', { ascending: false }); // ล่าสุดขึ้นก่อน

        setStock(stockData || []);
        setTransactions(txnData || []);

        // 3. คำนวณ Summary (Logic วันที่แบบแม่นยำ)
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // yyyy-mm-dd
        const currentMonthStr = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric',
            month: '2-digit',
        });

        const todayMap = new Map<string, SummaryItem>();
        const monthMap = new Map<string, SummaryItem>();

        const getOrInit = (map: Map<string, SummaryItem>, name: string, unit: string) => {
            if (!map.has(name))
                map.set(name, {
                    name,
                    unit,
                    received: 0,
                    used: 0,
                    remaining: remainingMap.get(name) || 0,
                });
            return map.get(name)!;
        };

        // --- สรุปยอด Branch Summary โดยรวม 'ADD', 'REMOVE', 'RESTORE' แบบเดียวกับ summary.month ---
        let branchSummaryIn = 0;
        let branchSummaryOut = 0;

        txnData?.forEach((t: any) => {
            const txnDate = new Date(t.created_at);
            const txnDateStr = txnDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
            const txnMonthStr = txnDate.toLocaleDateString('en-CA', {
                timeZone: 'Asia/Bangkok',
                year: 'numeric',
                month: '2-digit',
            });
            const prodName = t.products?.name || 'สินค้าไม่ระบุ';
            const unit = t.products?.unit || '';
            const qty = t.quantity_change;
            const type = t.type;

            // สำหรับสรุปรายเดือน "summary"
            const updateItem = (item: SummaryItem) => {
                if (type === 'ADD') {
                    item.received += qty;
                } else if (type === 'REMOVE') {
                    item.used += Math.abs(qty);
                } else if (type === 'RESTORE') {
                    // สำหรับ RESTORE: หักยอด "used" ลงเท่านั้น (ถือเป็นกู้คืนการเบิก)
                    item.used -= Math.abs(qty);
                }
            };

            if (txnMonthStr === currentMonthStr) {
                updateItem(getOrInit(monthMap, prodName, unit));

                // สำหรับ in_count, out_count  -- logic ให้เหมือนฝั่ง summary.month
                // in_count: รวมเฉพาะ ADD
                if (type === 'ADD') {
                    branchSummaryIn += qty;
                }

                // out_count: REMOVE จะ +, RESTORE จะ -
                if (type === 'REMOVE') {
                    branchSummaryOut += Math.abs(qty);
                } else if (type === 'RESTORE') {
                    branchSummaryOut -= Math.abs(qty);
                }
                // net_count ไม่ต้องคำนวณเอง ใช้ branchSummaryIn - branchSummaryOut ข้างล่าง
            }

            // สำหรับสรุปรายวัน "summary"
            if (txnDateStr === todayStr) {
                updateItem(getOrInit(todayMap, prodName, unit));
            }
        });

        setSummary({
            today: Array.from(todayMap.values()),
            month: Array.from(monthMap.values()),
        });

        setBranchSummary({
            in_count: branchSummaryIn,
            out_count: branchSummaryOut < 0 ? 0 : branchSummaryOut,
            net_count: branchSummaryIn - (branchSummaryOut < 0 ? 0 : branchSummaryOut),
            products_count: stockData?.length ?? 0,
        });

        // 4. เช็คของกำลังส่ง (จาก Orders)
        const { data: activeOrders } = await supabase
            .from('orders')
            .select('id, status, delivery_date, approved_by, order_items(quantity)')
            .eq('branch_id', branchId)
            .eq('status', 'IN_TRANSIT');

        setDelivering(activeOrders || []);
        setIsLoading(false);
    }, [branchId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // ฟังก์ชันกรองประวัติจากช่องค้นหา
    const filteredHistory = transactions.filter(
        (t) =>
            t.products?.name?.toLowerCase().includes(historySearch.toLowerCase()) ||
            t.performed_by?.toLowerCase().includes(historySearch.toLowerCase())
    );

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
                    <button
                        onClick={onClose}
                        className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 text-xl"
                    >
                        ✕
                    </button>
                </div>

                {/* Alert ของกำลังส่ง */}
                {delivering.length > 0 && (
                    <div className="bg-green-50 border-b border-green-100 p-3 flex items-center gap-3 px-6 animate-pulse">
                        <span className="text-2xl">🚚</span>
                        <div>
                            <p className="text-green-800 font-bold text-sm">มีสินค้ากำลังจัดส่งมายังสาขานี้</p>
                            <p className="text-green-600 text-xs">
                                จำนวน {delivering.length} ออเดอร์ (รอสาขากดรับของ)
                            </p>
                        </div>
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
                    {/* Tabs */}
                    <div className="flex space-x-2 mb-6 bg-white p-1.5 rounded-xl shadow-sm w-fit mx-auto overflow-x-auto max-w-full">
                        <button
                            onClick={() => setActiveTab('branchsummary')}
                            className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${
                                activeTab === 'branchsummary'
                                    ? 'bg-indigo-700 text-white shadow-md'
                                    : 'text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            🏪 สรุปยอดสาขา
                        </button>
                        <button
                            onClick={() => setActiveTab('stock')}
                            className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${
                                activeTab === 'stock'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            📦 สต็อกสินค้า
                        </button>
                        <button
                            onClick={() => setActiveTab('summary')}
                            className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${
                                activeTab === 'summary'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            📊 สรุปผลการใช้
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${
                                activeTab === 'history'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            📜 ประวัติรายการ
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="py-20 text-center">
                            <div className="animate-spin h-10 w-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto"></div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Tab: Branch Summary */}
                            {activeTab === 'branchsummary' && (
                                <div className="bg-white rounded-2xl shadow-sm border border-indigo-200 overflow-hidden p-0 md:p-0">
                                    <div className="bg-indigo-600 px-8 py-5">
                                        <h3 className="font-bold text-lg text-white flex items-center gap-2">
                                            🏪 สรุปผลรวมของสาขานี้
                                            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded font-mono font-normal">
                                                {toThaiDateDayFull(new Date())}
                                            </span>
                                        </h3>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-8 bg-white">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="rounded-full bg-green-100 p-3 text-green-700 text-xl">📥</div>
                                            <span className="text-xs text-slate-500">รับเข้าทั้งเดือน</span>
                                            <span className="font-bold text-lg text-green-800 font-mono">
                                                +{branchSummary.in_count}
                                            </span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="rounded-full bg-red-100 p-3 text-red-600 text-xl">📤</div>
                                            <span className="text-xs text-slate-500">เบิกออกทั้งเดือน</span>
                                            <span className="font-bold text-lg text-red-700 font-mono">
                                                -{branchSummary.out_count}
                                            </span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="rounded-full bg-indigo-100 p-3 text-indigo-700 text-xl">📊</div>
                                            <span className="text-xs text-slate-500">คงเหลือสุทธิรวมเดือน</span>
                                            <span
                                                className={`font-bold text-lg font-mono ${
                                                    branchSummary.net_count >= 0 ? 'text-green-700' : 'text-red-700'
                                                }`}
                                            >
                                                {branchSummary.net_count >= 0 ? '+' : '-'}
                                                {Math.abs(branchSummary.net_count)}
                                            </span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="rounded-full bg-yellow-100 p-3 text-yellow-700 text-xl">🗃️</div>
                                            <span className="text-xs text-slate-500">รายการสินค้าในคลัง</span>
                                            <span className="font-bold text-lg text-slate-800">
                                                {branchSummary.products_count}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tab: Stock */}
                            {activeTab === 'stock' && (
                                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                                    <table className="w-full">
                                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                                            <tr>
                                                <th className="px-6 py-3 text-left">สินค้า</th>
                                                <th className="px-6 py-3 text-right">คงเหลือ</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {stock.length === 0 ? (
                                                <tr>
                                                    <td colSpan={2} className="p-6 text-center text-slate-400">
                                                        ไม่มีข้อมูล
                                                    </td>
                                                </tr>
                                            ) : (
                                                stock.map((item: any, idx) => (
                                                    <tr key={idx}>
                                                        <td className="px-6 py-4 font-medium text-slate-800">
                                                            {item.products?.name}
                                                        </td>
                                                        <td className="px-6 py-4 text-right font-bold text-slate-700">
                                                            {item.current_quantity} {item.products?.unit}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Tab: Summary */}
                            {activeTab === 'summary' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* รายวัน */}
                                    <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden">
                                        <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex items-center justify-between">
                                            <h3 className="font-bold text-indigo-700">
                                                📅 วันนี้ ({toThaiDate(new Date())})
                                            </h3>
                                        </div>
                                        <div className="p-4">
                                            {summary.today.length === 0 ? (
                                                <div className="text-center text-slate-400 py-6">
                                                    วันนี้ยังไม่มีรายการ
                                                </div>
                                            ) : (
                                                <ul className="space-y-3">
                                                    {summary.today.map((item, idx) => (
                                                        <li
                                                            key={idx}
                                                            className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0 hover:bg-slate-50 transition px-2 rounded-lg"
                                                        >
                                                            <div className="flex flex-col">
                                                                <span className="text-slate-700 font-bold">
                                                                    {item.name}
                                                                </span>
                                                                <span className="text-xs text-slate-400 font-light">
                                                                    หน่วย: {item.unit}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex flex-col items-end mr-2 border-r border-slate-200 pr-3">
                                                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                                                                        คงเหลือ
                                                                    </span>
                                                                    <span className="font-mono text-lg font-bold text-slate-700">
                                                                        {item.remaining}
                                                                    </span>
                                                                </div>
                                                                <div className="flex flex-col gap-1 min-w-[70px]">
                                                                    <div
                                                                        className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${
                                                                            item.received > 0
                                                                                ? 'bg-green-100 text-green-700'
                                                                                : 'opacity-0'
                                                                        }`}
                                                                    >
                                                                        <span>รับ</span>
                                                                        <span>+{item.received}</span>
                                                                    </div>
                                                                    <div
                                                                        className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${
                                                                            item.used > 0
                                                                                ? 'bg-red-100 text-red-700'
                                                                                : 'opacity-0'
                                                                        }`}
                                                                    >
                                                                        <span>ใช้</span>
                                                                        <span>-{item.used}</span>
                                                                    </div>
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
                                                <div className="text-center text-slate-400 py-6">
                                                    เดือนนี้ยังไม่มีรายการ
                                                </div>
                                            ) : (
                                                <ul className="space-y-3">
                                                    {summary.month.map((item, idx) => (
                                                        <li
                                                            key={idx}
                                                            className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0 hover:bg-slate-50 transition px-2 rounded-lg"
                                                        >
                                                            <div className="flex flex-col">
                                                                <span className="text-slate-700 font-bold">
                                                                    {item.name}
                                                                </span>
                                                                <span className="text-xs text-slate-400 font-light">
                                                                    หน่วย: {item.unit}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex flex-col items-end mr-2 border-r border-slate-200 pr-3">
                                                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                                                                        คงเหลือ
                                                                    </span>
                                                                    <span className="font-mono text-lg font-bold text-slate-700">
                                                                        {item.remaining}
                                                                    </span>
                                                                </div>
                                                                <div className="flex flex-col gap-1 min-w-[70px]">
                                                                    <div
                                                                        className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${
                                                                            item.received > 0
                                                                                ? 'bg-green-100 text-green-700'
                                                                                : 'opacity-0'
                                                                        }`}
                                                                    >
                                                                        <span>รับ</span>
                                                                        <span>+{item.received}</span>
                                                                    </div>
                                                                    <div
                                                                        className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${
                                                                            item.used > 0
                                                                                ? 'bg-red-100 text-red-700'
                                                                                : 'opacity-0'
                                                                        }`}
                                                                    >
                                                                        <span>ใช้</span>
                                                                        <span>-{item.used}</span>
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
                            )}

                            {/* Tab: History */}
                            {activeTab === 'history' && (
                                <div className="space-y-4">
                                    {/* Search Bar */}
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="🔍 ค้นหาชื่อสินค้า หรือ ผู้ทำรายการ..."
                                            className="w-full p-3 pl-10 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                                            value={historySearch}
                                            onChange={(e) => setHistorySearch(e.target.value)}
                                        />
                                        <span className="absolute left-3 top-3.5 text-slate-400">📜</span>
                                    </div>
                                    {filteredHistory.length === 0 ? (
                                        <div className="text-center py-10 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
                                            {historySearch
                                                ? 'ไม่พบรายการที่ค้นหา'
                                                : 'ไม่พบประวัติรายการ'}
                                        </div>
                                    ) : (
                                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                                            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                                                {filteredHistory.map((txn: any) => (
                                                    <div
                                                        key={txn.id}
                                                        className="flex justify-between items-center p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {/* เปลี่ยนสีและไอคอนตาม Type */}
                                                            <div
                                                                className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                                                                    txn.type === 'ADD'
                                                                        ? 'bg-green-100 text-green-600'
                                                                        : txn.type === 'REMOVE'
                                                                        ? 'bg-red-100 text-red-600'
                                                                        : 'bg-blue-100 text-blue-600'
                                                                }`}
                                                            >
                                                                {txn.type === 'ADD'
                                                                    ? '📥'
                                                                    : txn.type === 'REMOVE'
                                                                    ? '📤'
                                                                    : '↩️'}
                                                            </div>
                                                            <div>
                                                                <p className="font-bold text-slate-700 text-sm">
                                                                    {txn.type === 'ADD'
                                                                        ? 'รับของเข้า'
                                                                        : txn.type === 'REMOVE'
                                                                        ? 'เบิกของออก'
                                                                        : 'กู้คืนรายการ'}
                                                                    <span className="ml-2 text-indigo-600 font-bold">
                                                                        {txn.products?.name}
                                                                    </span>
                                                                </p>
                                                                <div className="flex gap-2 text-xs text-slate-400 mt-0.5">
                                                                    <span>
                                                                        📅 {toThaiDate(txn.created_at)}
                                                                    </span>
                                                                    <span>
                                                                        🕒 {toThaiDateTime(txn.created_at)}
                                                                    </span>
                                                                    <span>👤 {txn.performed_by}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <span
                                                            className={`font-bold font-mono text-lg ${
                                                                txn.type === 'ADD' || txn.type === 'RESTORE'
                                                                    ? 'text-green-600'
                                                                    : 'text-red-600'
                                                            }`}
                                                        >
                                                            {(txn.type === 'ADD' || txn.type === 'RESTORE'
                                                                ? '+'
                                                                : '-')}
                                                            {txn.quantity_change} {txn.products?.unit}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {/* Footer Actions */}
                <div className="p-4 bg-white border-t border-slate-100 flex justify-end shrink-0">
                    <button
                        className="px-6 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition w-full sm:w-auto"
                        onClick={onClose}
                    >
                        ปิดหน้าต่าง
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BranchDetailModal;