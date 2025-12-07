import React, { useState, useEffect, useCallback } from 'react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import StockActionModal from '../components/StockActionModal';
import RecycleBinModal from '../components/RecycleBinModal';
import OrderRequestModal from '../components/OrderRequestModal';

// Define Types
type ProductStock = {
    id: number;
    productId: string;
    name: string;
    unit: string;
    min_alert_quantity: number;
    current_quantity: number;
    category?: string; // <-- เพิ่มตัวนี้ (รองรับสินค้าของเก่าไม่มีหมวดหมู่)
};
type SummaryItem = { name: string; unit: string; received: number; used: number; remaining: number; productId?: string; category?: string };
type ProductOption = { id: string; name: string; };
type Order = {
    id: string;
    status: 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'REJECTED';
    delivery_date: string;
    requested_date: string;
    approved_by?: string;
    created_at: string;
    order_items: { quantity: number, products: { name: string, unit: string, id: string } }[];
};

const BranchStock: React.FC = () => {
    const { branch } = useAuth();

    const [activeTab, setActiveTab] = useState<'stock' | 'history' | 'summary'>('stock');
    const [stock, setStock] = useState<ProductStock[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    // เปลี่ยน summary จาก array เป็นรวมหมวดหมู่
    const [summaryGrouped, setSummaryGrouped] = useState<{
        today: { [category: string]: SummaryItem[] },
        month: { [category: string]: SummaryItem[] }
    }>({ today: {}, month: {} });
    // คงอันเก่า ไว้ใช้เวลาต้องแยก struct
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    const [filterProductId, setFilterProductId] = useState<string>('');
    const [historySearch, setHistorySearch] = useState('');

    const [isLoading, setIsLoading] = useState(true);
    const [selectedProductForAction, setSelectedProductForAction] = useState<{id: string, name: string} | null>(null);
    const [isRecycleBinOpen, setIsRecycleBinOpen] = useState(false);
    const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
    const [activeOrders, setActiveOrders] = useState<Order[]>([]);
    const [confirmReceiveOrder, setConfirmReceiveOrder] = useState<Order | null>(null);
    const [confirmCancelOrder, setConfirmCancelOrder] = useState<string | null>(null);
    const [confirmDeleteStock, setConfirmDeleteStock] = useState<{id: number, name: string} | null>(null);
    const [successModal, setSuccessModal] = useState<{ show: boolean, message: string }>({ show: false, message: '' });
    const [isReceiving, setIsReceiving] = useState(false);

    // 👉 เพิ่ม State สำหรับ filter หมวดหมู่
    const [filterCategory, setFilterCategory] = useState<'all' | 'ingredients' | 'supplies'>('all');

    // --- ✅ Manual Timezone Helper Functions (ไม่ใช้ Intl, manual +7hr) ---
    const getThaiDateObj = (isoString: string) => {
        if (!isoString) return new Date();
        const date = new Date(isoString);
        return new Date(date.getTime() + 7 * 60 * 60 * 1000); // manual offset to +07:00
    };

    const formatThaiDate = (isoString: string) => {
        if (!isoString) return '-';
        const thaiTime = getThaiDateObj(isoString);
        const day = thaiTime.getUTCDate();
        const month = thaiTime.getUTCMonth();
        const year = thaiTime.getUTCFullYear() + 543; // พ.ศ.
        const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        return `${day} ${months[month]} ${year}`;
    };

    // -- แก้ไขให้เวลาไทยถูกต้อง ใช้ getHours()/getMinutes() (localtime of new Date) --
    const formatThaiTime = (isoString: string) => {
        if (!isoString) return '-';
        const thaiTime = getThaiDateObj(isoString);
        const hours = thaiTime.getHours().toString().padStart(2, '0');
        const minutes = thaiTime.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    };

    // สำหรับ summary mapping
    const getThaiDateKey = (isoString: string) => {
        const thaiTime = getThaiDateObj(isoString);
        const yyyy = thaiTime.getUTCFullYear();
        const mm = String(thaiTime.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(thaiTime.getUTCDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };
    const getThaiMonthKey = (isoString: string) => {
        return getThaiDateKey(isoString).slice(0, 7); // YYYY-MM
    };

    useEffect(() => {
        const fetchProducts = async () => {
            const { data } = await supabase.from('products').select('id, name').order('name');
            if (data) setAllProducts(data);
        };
        fetchProducts();
    }, []);

    const fetchData = useCallback(async () => {
        if (!branch?.id) return;
        setIsLoading(true);
        // 1. Stock (เพิ่ม category ใน select)
        const { data: stockData } = await supabase
            .from('stock')
            .select(`id, product_id, current_quantity, products ( name, unit, min_alert_quantity, category )`)
            .eq('branch_id', branch.id)
            .is('deleted_at', null);

        const formattedStock: ProductStock[] = (stockData ?? []).map((item: any) => {
            const prod = Array.isArray(item.products) ? item.products[0] : item.products;
            if (!prod) return null;
            return {
                id: item.id,
                productId: item.product_id,
                current_quantity: Number(item.current_quantity),
                name: prod.name,
                unit: prod.unit,
                min_alert_quantity: Number(prod.min_alert_quantity) || 0,
                category: prod.category || 'ingredients', // default = ingredients
            };
        }).filter(Boolean) as ProductStock[];
        setStock(formattedStock);

        // 2. Orders
        const { data: orderData } = await supabase
            .from('orders')
            .select(`*, order_items(quantity, products(name, unit, id))`)
            .eq('branch_id', branch.id)
            .in('status', ['PENDING', 'IN_TRANSIT'])
            .order('created_at', { ascending: false });

        setActiveOrders(orderData || []);

        // 3. Transactions & Summary
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        startOfMonth.setDate(startOfMonth.getDate() - 1);

        const { data: txnData } = await supabase
            .from('transactions')
            .select('*, products(name, unit, id)')
            .eq('branch_id', branch.id)
            .gte('created_at', startOfMonth.toISOString())
            .order('created_at', { ascending: false });

        setTransactions(txnData || []);

        // --- คำนวณ Summary (Manual Thai Timezone) ---
        const nowISO = new Date().toISOString();
        const todayKey = getThaiDateKey(nowISO);
        const currentMonthKey = getThaiMonthKey(nowISO);

        // Change: Fill summary with ALL products in stock by keying with productId
        const todayMap = new Map<string, SummaryItem>();
        const monthMap = new Map<string, SummaryItem>();
        // เพิ่ม categoryMap เอาไว้ดู category จาก productId
        const categoryMap = new Map<string, string>();

        // 1. Add all products in current stock as base "remaining" (by productId)
        formattedStock.forEach((s) => {
            todayMap.set(s.productId, { name: s.name, unit: s.unit, received: 0, used: 0, remaining: s.current_quantity, productId: s.productId, category: s.category });
            monthMap.set(s.productId, { name: s.name, unit: s.unit, received: 0, used: 0, remaining: s.current_quantity, productId: s.productId, category: s.category });
            categoryMap.set(s.productId, s.category || 'ingredients');
        });

        // 2. Process transactions to update received/used (by productId)
        txnData?.forEach((t: any) => {
            const txnDateKey = getThaiDateKey(t.created_at);
            const txnMonthKey = getThaiMonthKey(t.created_at);

            // Removed unused prodName and unit
            const productId = t.products?.id;
            const qty = t.quantity_change;
            const type = t.type;

            // Try to find items using productId, else fallback to name+unit key for legacy/corner cases
            const todayItem = productId && todayMap.has(productId) ? todayMap.get(productId)! : undefined;
            const monthItem = productId && monthMap.has(productId) ? monthMap.get(productId)! : undefined;

            const applyTo = (item: SummaryItem | undefined) => {
                if (!item) return;
                if (type === 'ADD') item.received += qty;
                else if (type === 'REMOVE') item.used += Math.abs(qty);
                else if (type === 'RESTORE') { item.used -= Math.abs(qty); if (item.used < 0) item.used = 0; }
            };

            if (txnMonthKey === currentMonthKey && monthItem) applyTo(monthItem);
            if (txnDateKey === todayKey && todayItem) applyTo(todayItem);
        });

        // 3. Convert to arrays and sort + group by category
        const groupByCategory = (arr: SummaryItem[]) => {
            const grouped: { [category: string]: SummaryItem[] } = {};
            arr.forEach(item => {
                const cat = item.category || 'ingredients';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(item);
            });
            // Sort inside group
            Object.keys(grouped).forEach(cat => {
                grouped[cat] = grouped[cat].sort((a, b) => a.name.localeCompare(b.name, 'th'));
            });
            return grouped;
        };

        const todaySummaryArr: SummaryItem[] = Array.from(todayMap.values());
        const monthSummaryArr: SummaryItem[] = Array.from(monthMap.values());

        const todayGrouped = groupByCategory(todaySummaryArr);
        const monthGrouped = groupByCategory(monthSummaryArr);

        setSummaryGrouped({ today: todayGrouped, month: monthGrouped });
        setIsLoading(false);
    }, [branch?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Actions
    const handleClickCancel = (orderId: string) => setConfirmCancelOrder(orderId);

    const handleConfirmCancel = async () => {
        if (!confirmCancelOrder) return;
        const { error } = await supabase.from('orders').delete().eq('id', confirmCancelOrder);
        if (error) alert('Error: ' + error.message); else { fetchData(); setSuccessModal({ show: true, message: 'ยกเลิกคำขอเรียบร้อยแล้ว' }); }
        setConfirmCancelOrder(null);
    };
    const handleClickReceive = (order: Order) => setConfirmReceiveOrder(order);

    const handleConfirmReceive = async () => {
        if (!confirmReceiveOrder || isReceiving) return;
        setIsReceiving(true);
        try {
            for (const item of confirmReceiveOrder.order_items) {
                const { error } = await supabase.rpc('perform_stock_transaction', {
                    p_branch_id: branch?.id,
                    p_product_id: item.products.id,
                    p_quantity_change: item.quantity,
                    p_type: 'ADD',
                    p_performed_by: branch?.login_code
                });
                if (error) throw error;
            }
            await supabase.from('orders').update({ status: 'COMPLETED' }).eq('id', confirmReceiveOrder.id);

            fetchData();
            setConfirmReceiveOrder(null);
            setSuccessModal({ show: true, message: 'รับของเรียบร้อย! สต็อกอัปเดตแล้ว' });
        } catch (err: any) {
            alert('Error: ' + err.message);
        } finally {
            setIsReceiving(false);
        }
    };
    const handleDeleteItem = async () => {
        if (!confirmDeleteStock) return;
        const { error } = await supabase.from('stock').update({ deleted_at: new Date().toISOString() }).eq('id', confirmDeleteStock.id);
        if (error) alert('ลบไม่สำเร็จ: ' + error.message); else fetchData();
        setConfirmDeleteStock(null);
    };

    // 👉 ปรับ Logic กรองสินค้า: ทั้ง product และหมวดหมู่
    const displayedStock = stock.filter(item => {
        // 1. ตามสินค้าที่เลือก
        const matchProduct = filterProductId ? item.productId === filterProductId : true;
        // 2. ตามหมวดหมู่ที่เลือก ('all' ผ่านหมด, อื่นๆ = เทียบ category)
        const matchCategory = filterCategory === 'all' ? true : (item.category === filterCategory);
        return matchProduct && matchCategory;
    });

    const displayedHistory = transactions.filter(t =>
        (t.products?.name?.toLowerCase() || '').includes(historySearch.toLowerCase()) ||
        (t.performed_by?.toLowerCase() || '').includes(historySearch.toLowerCase())
    );
    const getStatusBadge = (qty: number, min: number) => {
        if (qty === 0) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">หมด</span>;
        else if (qty <= min) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-600">ใกล้หมด</span>;
        else return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-600">ปกติ</span>;
    };

    if (isLoading) return <div className="p-10 text-center"><div className="animate-spin h-10 w-10 border-4 border-indigo-600 rounded-full border-t-transparent mx-auto"></div></div>;

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 animate-fade-in space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3"><span className="text-3xl">📦</span><div><h2 className="text-2xl font-bold text-slate-800">จัดการสต็อก</h2><p className="text-slate-500">สาขา: {branch?.branch_name}</p></div></div>
                <div className="flex gap-3">
                    <button onClick={() => setIsOrderModalOpen(true)} className="bg-blue-600 text-white px-5 py-3 rounded-xl shadow-lg hover:bg-blue-700 transition font-bold flex items-center gap-2"><span>📝</span> สั่งของเพิ่ม</button>
                    <button onClick={() => setIsRecycleBinOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-red-500 transition shadow-sm font-bold text-sm">🗑️ ประวัติการใช้ (24ชม.)</button>
                </div>
            </div>

            {/* Active Orders List */}
            {activeOrders.length > 0 && (
                <div className="space-y-4">
                    <h3 className="font-bold text-slate-700 text-lg flex items-center gap-2">📦 รายการสั่งซื้อ <span className="bg-slate-100 text-slate-500 text-xs px-2 py-1 rounded-full">{activeOrders.length}</span></h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {activeOrders.map(order => {
                            const isAdminPush = order.approved_by === 'Admin' || order.approved_by === 'admin';
                            return (
                                <div key={order.id} className={`p-5 rounded-2xl border-2 ${order.status === 'IN_TRANSIT' ? 'border-green-500 bg-green-50' : 'border-yellow-400 bg-yellow-50'} relative overflow-hidden shadow-sm hover:shadow-md transition`}>
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <span className={`text-xs font-bold px-2 py-1 rounded-md ${order.status === 'IN_TRANSIT' ? 'bg-green-200 text-green-800' : 'bg-yellow-200 text-yellow-800'}`}>
                                                {order.status === 'IN_TRANSIT' ? '🚚 กำลังมาส่ง' : '⏳ รออนุมัติ'}
                                            </span>
                                            <div className="mt-3 text-sm text-slate-600 space-y-1">
                                                {isAdminPush ? (
                                                    <p className="font-bold text-indigo-600">🎁 ได้รับของจาก: {order.approved_by}</p>
                                                ) : (
                                                    <>
                                                        <p>📅 ขอรับวันที่: <span className="font-bold">{formatThaiDate(order.requested_date)}</span></p>
                                                        <div className="flex items-center gap-2 text-xs text-slate-400">
                                                            <span>⏰ กดขอเมื่อ: <span className="font-bold text-slate-500">{formatThaiTime(order.created_at)}</span></span>
                                                        </div>
                                                    </>
                                                )}
                                                {order.status === 'IN_TRANSIT' && order.delivery_date && (
                                                    <p className="font-bold text-green-700 pt-1">
                                                        🚛 ของจะถึง: {formatThaiDate(order.delivery_date)}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        {order.status === 'IN_TRANSIT' ? (
                                            <button onClick={() => handleClickReceive(order)} className="bg-green-600 text-white px-4 py-2 rounded-xl font-bold shadow-md hover:bg-green-700 transition animate-pulse">กดรับของ</button>
                                        ) : (
                                            <button onClick={() => handleClickCancel(order.id)} className="text-red-500 bg-white border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-50 transition">ยกเลิก</button>
                                        )}
                                    </div>
                                    <ul className="space-y-1 text-sm text-slate-600 bg-white/50 p-3 rounded-lg border border-slate-200/50">
                                        {order.order_items.map((item, idx) => (<li key={idx} className="flex justify-between"><span>• {item.products.name}</span><span className="font-bold">{item.quantity} {item.products.unit}</span></li>))}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex space-x-2 bg-white p-1.5 rounded-xl shadow-sm w-fit overflow-x-auto max-w-full">
                <button onClick={() => setActiveTab('stock')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'stock' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📦 สต็อกคงเหลือ</button>
                <button onClick={() => setActiveTab('summary')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'summary' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📊 สรุปผลการใช้</button>
                <button onClick={() => setActiveTab('history')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-pink-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📅 ประวัติย้อนหลัง</button>
            </div>

            {/* Stock Tab */}
            {activeTab === 'stock' && (
                <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden animate-slide-up">
                    {/* 5. ปุ่มเลือกหมวดหมู่ และ dropdown filter เดิม */}
                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-4">
                        {/* ปุ่มเลือกหมวดหมู่ */}
                        <div className="flex gap-2">
                            <button
                                onClick={() => setFilterCategory('all')}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${filterCategory === 'all' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`}
                            >
                                ทั้งหมด
                            </button>
                            <button
                                onClick={() => setFilterCategory('ingredients')}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${filterCategory === 'ingredients' ? 'bg-green-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-green-50'}`}
                            >
                                🥬 วัตถุดิบ
                            </button>
                            <button
                                onClick={() => setFilterCategory('supplies')}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${filterCategory === 'supplies' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-blue-50'}`}
                            >
                                🥤 แก้ว/อุปกรณ์
                            </button>
                        </div>
                        {/* Dropdown กรองรายชื่อสินค้า (ของเดิม) */}
                        <div className="flex items-center gap-3 w-full sm:w-auto">
                            <span className="text-sm font-bold text-slate-500 whitespace-nowrap">🔍 กรองสินค้า:</span>
                            <select value={filterProductId} onChange={(e) => setFilterProductId(e.target.value)} className="p-2.5 pl-4 pr-10 bg-white border border-slate-200 rounded-xl text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm w-full sm:w-64 cursor-pointer">
                                <option value="">ทั้งหมด ({stock.length})</option>
                                {allProducts.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                            </select>
                        </div>
                    </div>
                    <table className="min-w-full">
                        <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">สินค้า</th>
                                <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase">สถานะ</th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase">คงเหลือ</th>
                                <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase">จัดการ</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {displayedStock.length > 0 ? displayedStock.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50/50 transition group">
                                    <td className="px-6 py-4 text-sm font-bold text-slate-700">
                                        {item.name}
                                        {/* แสดงหมวดหมู่เล็กๆต่อท้ายชื่อ ถ้ามี */}
                                        {item.category &&
                                            <span className={`ml-2 text-xs rounded px-2 py-0.5 ${item.category === 'supplies' ? 'bg-blue-50 text-blue-500 border border-blue-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                                            {item.category === 'supplies' ? 'แก้ว/อุปกรณ์' : 'วัตถุดิบ'}
                                            </span>
                                        }
                                    </td>
                                    <td className="px-6 py-4 text-center">{getStatusBadge(item.current_quantity, item.min_alert_quantity)}</td>
                                    <td className="px-6 py-4 text-sm text-right font-mono font-bold text-slate-800 text-lg">{item.current_quantity} <span className="text-xs text-slate-400 font-sans font-normal ml-1">{item.unit}</span></td>
                                    <td className="px-6 py-4 text-center flex justify-center gap-2">
                                        <button onClick={() => setSelectedProductForAction({ id: item.productId, name: item.name })} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-500 hover:text-white transition shadow-sm" title="ใช้ของ">📉 ใช้ของ</button>
                                        <button onClick={() => setConfirmDeleteStock({ id: item.id, name: item.name })} className="p-2 text-slate-300 hover:text-slate-500 hover:bg-slate-100 rounded-lg transition" title="ลบรายการ">🗑️</button>
                                    </td>
                                </tr>
                            )) : (<tr><td colSpan={4} className="p-10 text-center text-slate-400">ไม่พบข้อมูลสินค้า</td></tr>)}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Summary Tab */}
            {activeTab === 'summary' && (
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* วันนี้ */}
                    <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden flex flex-col">
                        <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex justify-between items-center">
                            <h3 className="font-bold text-indigo-700">📅 วันนี้</h3>
                            <span className="text-xs text-indigo-500 font-bold">{formatThaiDate(new Date().toISOString())}</span>
                        </div>
                        <div className="p-4 max-h-[400px] overflow-y-auto custom-scrollbar">
                            {/* ถ้าไม่มีข้อมูลทุกหมวดหมู่ */}
                            {Object.values(summaryGrouped.today).flat().length === 0 ? (
                                <div className="text-center py-8 text-slate-400">ไม่มีรายการ</div>
                            ) : (
                                Object.entries(summaryGrouped.today).map(([category, items]) => (
                                    <div key={category} className="mb-4 last:mb-0">
                                        <div className="flex items-center gap-2 mb-2">
                                            {category === 'ingredients' ? (
                                                <span className="bg-green-50 text-green-700 border font-bold px-3 py-1 rounded border-green-100 text-sm">🥬 วัตถุดิบ</span>
                                            ) : category === 'supplies' ? (
                                                <span className="bg-blue-50 text-blue-600 border font-bold px-3 py-1 rounded border-blue-100 text-sm">🥤 แก้ว/อุปกรณ์</span>
                                            ) : (
                                                <span className="bg-slate-50 text-slate-500 border font-bold px-3 py-1 rounded border-slate-200 text-sm">{category}</span>
                                            )}
                                        </div>
                                        {items.length === 0 ? (
                                            <div className="text-center py-4 text-slate-300">ไม่มีสินค้าในหมวดนี้</div>
                                        ) : (
                                            items.map((item, i) => (
                                                <div key={i} className="flex justify-between items-center py-3 border-b border-slate-100 last:border-0">
                                                    <div className="flex flex-col"><span className="text-slate-700 font-bold">{item.name}</span><span className="text-xs text-slate-400">หน่วย: {item.unit}</span></div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex flex-col items-end pr-3 border-r border-slate-200"><span className="text-[10px] text-slate-400 uppercase">คงเหลือ</span><span className="font-bold text-slate-700">{item.remaining}</span></div>
                                                        <div className="flex flex-col gap-1 text-[10px] font-bold"><span className={`px-2 py-0.5 rounded ${item.received > 0 ? 'bg-green-100 text-green-700' : 'opacity-0'}`}>รับ +{item.received}</span><span className={`px-2 py-0.5 rounded ${item.used > 0 ? 'bg-red-100 text-red-700' : 'opacity-0'}`}>ใช้ -{item.used}</span></div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                    {/* เดือนนี้ */}
                    <div className="bg-white rounded-2xl shadow-sm border border-orange-100 overflow-hidden flex flex-col">
                        <div className="bg-orange-50 p-4 border-b border-orange-100 flex justify-between items-center"><h3 className="font-bold text-orange-700">🗓️ เดือนนี้</h3></div>
                        <div className="p-4 max-h-[400px] overflow-y-auto custom-scrollbar">
                            {Object.values(summaryGrouped.month).flat().length === 0 ? (
                                <div className="text-center py-8 text-slate-400">ไม่มีรายการ</div>
                            ) : (
                                Object.entries(summaryGrouped.month).map(([category, items]) => (
                                    <div key={category} className="mb-4 last:mb-0">
                                        <div className="flex items-center gap-2 mb-2">
                                            {category === 'ingredients' ? (
                                                <span className="bg-green-50 text-green-700 border font-bold px-3 py-1 rounded border-green-100 text-sm">🥬 วัตถุดิบ</span>
                                            ) : category === 'supplies' ? (
                                                <span className="bg-blue-50 text-blue-600 border font-bold px-3 py-1 rounded border-blue-100 text-sm">🥤 แก้ว/อุปกรณ์</span>
                                            ) : (
                                                <span className="bg-slate-50 text-slate-500 border font-bold px-3 py-1 rounded border-slate-200 text-sm">{category}</span>
                                            )}
                                        </div>
                                        {items.length === 0 ? (
                                            <div className="text-center py-4 text-slate-300">ไม่มีสินค้าในหมวดนี้</div>
                                        ) : (
                                            items.map((item, i) => (
                                                <div key={i} className="flex justify-between items-center py-3 border-b border-slate-100 last:border-0">
                                                    <div className="flex flex-col"><span className="text-slate-700 font-bold">{item.name}</span><span className="text-xs text-slate-400">หน่วย: {item.unit}</span></div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex flex-col items-end pr-3 border-r border-slate-200"><span className="text-[10px] text-slate-400 uppercase">คงเหลือ</span><span className="font-bold text-slate-700">{item.remaining}</span></div>
                                                        <div className="flex flex-col gap-1 text-[10px] font-bold"><span className={`px-2 py-0.5 rounded ${item.received > 0 ? 'bg-green-100 text-green-700' : 'opacity-0'}`}>รับ +{item.received}</span><span className={`px-2 py-0.5 rounded ${item.used > 0 ? 'bg-red-100 text-red-700' : 'opacity-0'}`}>ใช้ -{item.used}</span></div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
                <div className="p-6">
                    <div className="relative mb-4">
                        <input type="text" placeholder="🔍 ค้นหาประวัติ..." className="w-full p-3 pl-10 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} />
                        <span className="absolute left-3 top-3.5 text-slate-400">📜</span>
                    </div>
                    <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                        {displayedHistory.length === 0 ? (
                            <div className="text-center py-10 text-slate-400 border-2 border-dashed rounded-xl">ไม่พบประวัติ</div>
                        ) : (
                            displayedHistory.map((txn) => (
                                <div key={txn.id} className="flex justify-between items-center p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                                            txn.type === 'ADD'
                                                ? 'bg-green-100 text-green-600'
                                                : txn.type === 'REMOVE'
                                                    ? 'bg-red-100 text-red-600'
                                                    : 'bg-blue-100 text-blue-600'
                                        }`}>
                                            {txn.type === 'ADD' ? '📥' : txn.type === 'REMOVE' ? '📤' : '↩️'}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-700 text-sm">
                                                {txn.type === 'ADD'
                                                    ? 'รับของเข้า'
                                                    : txn.type === 'REMOVE'
                                                        ? 'เบิกของออก'
                                                        : 'กู้คืนรายการ'}{' '}
                                                <span className="ml-2 text-indigo-600 font-bold">{txn.products?.name}</span>
                                            </p>
                                            {/* ✅ Layout: เวลา + ชื่อผู้ทำ = บรรทัดเดียว ชิดขวา */}
                                            <div className="flex gap-4 text-xs text-slate-400 mt-0.5 items-center">
                                                <span>📅 {formatThaiDate(txn.created_at)} {formatThaiTime(txn.created_at)}</span>
                                                <span>👤 โดย: {txn.performed_by}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <span
                                        className={`font-bold font-mono text-lg ${
                                            txn.type === 'ADD' || txn.type === 'RESTORE' ? 'text-green-600' : 'text-red-600'
                                        }`}
                                    >
                                        {(txn.type === 'ADD' || txn.type === 'RESTORE' ? '+' : '-')}{txn.quantity_change} {txn.products?.unit}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Modals (Modal ที่ซ้อนทับกันได้ ต้องใช้ z-index สูงๆ หรือวางเรียงให้ถูก) */}
            {selectedProductForAction && branch && (<StockActionModal onClose={() => setSelectedProductForAction(null)} onSuccess={fetchData} branchId={branch.id} productId={selectedProductForAction.id} productName={selectedProductForAction.name} loginCode={branch.login_code} />)}
            {isRecycleBinOpen && branch && (<RecycleBinModal branchId={branch.id} onClose={() => setIsRecycleBinOpen(false)} onSuccess={fetchData} />)}
            {isOrderModalOpen && branch && (<OrderRequestModal branchId={branch.id} onClose={() => setIsOrderModalOpen(false)} onSuccess={() => { fetchData(); setSuccessModal({ show: true, message: 'ส่งคำขอเรียบร้อย! รอแอดมินอนุมัติ' }); }} />)}

            {/* Custom Modal: ยืนยันรับของ */}
            {confirmReceiveOrder && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-fade-in">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmReceiveOrder(null)}></div>
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden animate-slide-up">
                        <div className="bg-green-600 p-6 text-white text-center"><div className="text-5xl mb-2">📦</div><h3 className="text-xl font-bold">ยืนยันรับสินค้า</h3></div>
                        <div className="p-6 bg-slate-50">
                            <ul className="bg-white p-4 rounded-xl border border-slate-200 space-y-2 text-sm text-slate-700 mb-6 max-h-40 overflow-y-auto">{confirmReceiveOrder.order_items.map((item, i) => (<li key={i} className="flex justify-between border-b border-slate-100 last:border-0 pb-1"><span>{item.products.name}</span><span className="font-bold">{item.quantity} {item.products.unit}</span></li>))}</ul>
                            <div className="flex gap-3"><button onClick={() => setConfirmReceiveOrder(null)} disabled={isReceiving} className="flex-1 py-3 rounded-xl bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">ยกเลิก</button><button onClick={handleConfirmReceive} disabled={isReceiving} className={`flex-1 py-3 rounded-xl font-bold text-white shadow-lg transition ${isReceiving ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'}`}>{isReceiving ? '⏳ กำลังบันทึก...' : '✅ ยืนยันรับของ'}</button></div>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Modal: ยืนยันยกเลิก */}
            {confirmCancelOrder && (
                 <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmCancelOrder(null)}></div>
                    <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl relative z-10 p-6 text-center animate-slide-up">
                        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">🗑️</span></div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">ยกเลิกคำขอ?</h3>
                        <p className="text-slate-500 text-sm mb-6">คุณแน่ใจหรือไม่ที่จะลบคำขอนี้?</p>
                        <div className="flex gap-3"><button onClick={() => setConfirmCancelOrder(null)} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200">ไม่, เก็บไว้</button><button onClick={handleConfirmCancel} className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 shadow-lg shadow-red-200">ใช่, ยกเลิกเลย</button></div>
                    </div>
                </div>
            )}

            {/* Custom Modal: ยืนยันลบสินค้า */}
            {confirmDeleteStock && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteStock(null)}></div>
                    <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl relative z-10 p-6 text-center animate-slide-up">
                        <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">⚠️</span></div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">ซ่อนรายการสินค้า?</h3>
                        <div className="flex gap-3"><button onClick={() => setConfirmDeleteStock(null)} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200">ยกเลิก</button><button onClick={handleDeleteItem} className="flex-1 py-3 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-600 shadow-lg shadow-orange-200">ยืนยันซ่อน</button></div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {successModal.show && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSuccessModal({ show: false, message: '' })}></div>
                    <div className="bg-white rounded-3xl shadow-2xl p-8 relative z-10 flex flex-col items-center max-w-sm w-full text-center animate-bounce-in">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 text-4xl animate-ping-once">🎉</div>
                        <h3 className="text-2xl font-bold text-slate-800 mb-2">สำเร็จ!</h3>
                        <p className="text-slate-600 mb-6">{successModal.message}</p>
                        <button onClick={() => setSuccessModal({ show: false, message: '' })} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition transform active:scale-95">ตกลง</button>
                    </div>
                </div>
            )}

        </div>
    );
};

export default BranchStock;