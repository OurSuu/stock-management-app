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
};

type SummaryItem = { name: string; unit: string; received: number; used: number; remaining: number; };
type ProductOption = { id: string; name: string; };
type Order = {
    id: string;
    status: 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'REJECTED';
    delivery_date: string;
    requested_date: string;
    approved_by?: string;
    order_items: { quantity: number, products: { name: string, unit: string, id: string } }[];
};

const BranchStock: React.FC = () => {
    const { branch } = useAuth();

    const [activeTab, setActiveTab] = useState<'stock' | 'history' | 'summary'>('stock');
    const [stock, setStock] = useState<ProductStock[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [summary, setSummary] = useState<{ today: SummaryItem[], month: SummaryItem[] }>({ today: [], month: [] });
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

        // 1. Stock
        const { data: stockData } = await supabase
            .from('stock')
            .select(`id, product_id, current_quantity, products ( name, unit, min_alert_quantity )`)
            .eq('branch_id', branch.id)
            .is('deleted_at', null);

        // เก็บยอดคงเหลือไว้ใช้ใน Summary
        const remainingMap = new Map<string, number>();

        const formattedStock: ProductStock[] = (stockData ?? []).map((item: any) => {
            const prod = Array.isArray(item.products) ? item.products[0] : item.products;
            if (!prod) return null;
            remainingMap.set(prod.name, item.current_quantity);
            return {
                id: item.id,
                productId: item.product_id,
                current_quantity: item.current_quantity,
                name: prod.name,
                unit: prod.unit,
                min_alert_quantity: prod.min_alert_quantity,
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
        const historyLimitDate = new Date();
        historyLimitDate.setDate(historyLimitDate.getDate() - 60);

        const { data: txnData } = await supabase
            .from('transactions')
            .select('*, products(name, unit)')
            .eq('branch_id', branch.id)
            .gte('created_at', historyLimitDate.toISOString())
            .order('created_at', { ascending: false });

        setTransactions(txnData || []);

        // --- คำนวณ Summary ---
        const toThaiDateString = (date: Date) => new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        const toThaiMonthString = (date: Date) => new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' });

        const todayKey = toThaiDateString(new Date());
        const currentMonthKey = toThaiMonthString(new Date());

        const todayMap = new Map<string, SummaryItem>();
        const monthMap = new Map<string, SummaryItem>();

        const getOrInit = (map: Map<string, SummaryItem>, name: string, unit: string) => {
            if (!map.has(name)) map.set(name, { name, unit, received: 0, used: 0, remaining: remainingMap.get(name) || 0 });
            return map.get(name)!;
        };

        txnData?.forEach((t: any) => {
            const txnDate = new Date(t.created_at);
            const txnDateKey = toThaiDateString(txnDate);
            const txnMonthKey = toThaiMonthString(txnDate);

            const prodName = t.products?.name || 'สินค้าไม่ระบุ';
            const unit = t.products?.unit || '';
            const qty = t.quantity_change;
            const type = t.type;

            const updateItem = (item: SummaryItem) => {
                if (type === 'ADD') {
                    item.received += qty;
                } else if (type === 'REMOVE') {
                    item.used += Math.abs(qty);
                } else if (type === 'RESTORE') {
                    item.used -= Math.abs(qty);
                }
            };

            if (txnMonthKey === currentMonthKey) {
                updateItem(getOrInit(monthMap, prodName, unit));
            }
            if (txnDateKey === todayKey) {
                updateItem(getOrInit(todayMap, prodName, unit));
            }
        });

        setSummary({
            today: Array.from(todayMap.values()),
            month: Array.from(monthMap.values())
        });

        setIsLoading(false);
    }, [branch?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // --- Actions ---
    const handleClickCancel = (orderId: string) => setConfirmCancelOrder(orderId);
    const handleConfirmCancel = async () => {
        if (!confirmCancelOrder) return;
        const { error } = await supabase.from('orders').delete().eq('id', confirmCancelOrder);
        if (error) alert('Error: ' + error.message);
        else { fetchData(); setSuccessModal({ show: true, message: 'ยกเลิกคำขอเรียบร้อยแล้ว' }); }
        setConfirmCancelOrder(null);
    };

    const handleClickReceive = (order: Order) => setConfirmReceiveOrder(order);
    const handleConfirmReceive = async () => {
        if (!confirmReceiveOrder) return;
        try {
            for (const item of confirmReceiveOrder.order_items) {
                await supabase.from('transactions').insert({
                    branch_id: branch?.id,
                    product_id: item.products.id,
                    type: 'ADD',
                    quantity_change: item.quantity,
                    performed_by: branch?.login_code
                });
                await supabase.rpc('update_stock_quantity', { p_branch_id: branch?.id, p_product_id: item.products.id, p_quantity_change: item.quantity });
            }
            await supabase.from('orders').update({ status: 'COMPLETED' }).eq('id', confirmReceiveOrder.id);
            fetchData();
            setConfirmReceiveOrder(null);
            setSuccessModal({ show: true, message: 'รับของเรียบร้อย! สต็อกอัปเดตแล้ว' });
        } catch (err: any) { alert('Error: ' + err.message); }
    };

    const handleDeleteItem = async () => {
        if (!confirmDeleteStock) return;
        const { error } = await supabase.from('stock').update({ deleted_at: new Date().toISOString() }).eq('id', confirmDeleteStock.id);
        if (error) alert('ลบไม่สำเร็จ: ' + error.message); else fetchData();
        setConfirmDeleteStock(null);
    };

    const displayedStock = filterProductId ? stock.filter(item => item.productId === filterProductId) : stock;
    const displayedHistory = transactions.filter(t =>
        (t.products?.name?.toLowerCase() || '').includes(historySearch.toLowerCase()) ||
        (t.performed_by?.toLowerCase() || '').includes(historySearch.toLowerCase())
    );

    if (isLoading)
        return <div className="p-10 text-center"><div className="animate-spin h-10 w-10 border-4 border-indigo-600 rounded-full border-t-transparent mx-auto"></div></div>;

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 animate-fade-in space-y-8">

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">📦</span>
                    <div><h2 className="text-2xl font-bold text-slate-800">จัดการสต็อก</h2><p className="text-slate-500">สาขา: {branch?.branch_name}</p></div>
                </div>
                <div className="flex gap-3">
                    <button onClick={() => setIsOrderModalOpen(true)} className="bg-blue-600 text-white px-5 py-3 rounded-xl shadow-lg hover:bg-blue-700 transition font-bold flex items-center gap-2"><span>📝</span> สั่งของเพิ่ม</button>
                    <button onClick={() => setIsRecycleBinOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-red-500 transition shadow-sm font-bold text-sm">🗑️ ประวัติการใช้ (24ชม.)</button>
                </div>
            </div>

            {/* Active Orders */}
            {activeOrders.length > 0 && (
                <div className="space-y-4">
                    <h3 className="font-bold text-slate-700 text-lg flex items-center gap-2">📦 รายการสั่งซื้อ <span className="bg-slate-100 text-slate-500 text-xs px-2 py-1 rounded-full">{activeOrders.length}</span></h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {activeOrders.map(order => (
                            <div key={order.id} className={`p-5 rounded-2xl border-2 ${order.status === 'IN_TRANSIT' ? 'border-green-500 bg-green-50' : 'border-yellow-400 bg-yellow-50'} relative overflow-hidden shadow-sm hover:shadow-md transition`}>
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <span className={`text-xs font-bold px-2 py-1 rounded-md ${order.status === 'IN_TRANSIT' ? 'bg-green-200 text-green-800' : 'bg-yellow-200 text-yellow-800'}`}>
                                            {order.status === 'IN_TRANSIT' ? '🚚 กำลังมาส่ง' : '⏳ รออนุมัติ'}
                                        </span>
                                        <p className="text-sm text-slate-500 mt-1">ขอวันที่: {new Date(order.requested_date).toLocaleDateString('th-TH')}</p>
                                        {order.status === 'IN_TRANSIT' && order.approved_by && (
                                            <p className="text-xs text-slate-400 mt-1">ส่งโดย: {order.approved_by}</p>
                                        )}
                                    </div>
                                    {order.status === 'IN_TRANSIT' ? (
                                        <button onClick={() => handleClickReceive(order)} className="bg-green-600 text-white px-4 py-2 rounded-xl font-bold shadow-md hover:bg-green-700 transition animate-pulse">กดรับของ</button>
                                    ) : (
                                        <button onClick={() => handleClickCancel(order.id)} className="text-red-500 bg-white border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-50 transition">ยกเลิก</button>
                                    )}
                                </div>
                                {/* Order Items List */}
                                <ul className="space-y-1 text-sm text-slate-600">
                                    {order.order_items.map((item, idx) => (
                                        <li key={idx} className="flex justify-between">
                                            <span>• {item.products.name}</span>
                                            <span className="font-bold">{item.quantity} {item.products.unit}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex space-x-2 bg-white p-1.5 rounded-xl shadow-sm w-fit overflow-x-auto max-w-full">
                <button onClick={() => setActiveTab('stock')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'stock' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📦 สต็อกคงเหลือ</button>
                <button onClick={() => setActiveTab('summary')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'summary' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📊 สรุปผลการใช้</button>
                <button onClick={() => setActiveTab('history')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-pink-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>📅 ประวัติย้อนหลัง</button>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden animate-slide-up min-h-[300px]">
                
                {/* Tab 1: Stock */}
                {activeTab === 'stock' && (
                    <>
                        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                                <tr><th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">สินค้า</th><th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase">สถานะ</th><th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase">คงเหลือ</th><th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase">จัดการ</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {displayedStock.length > 0 ? displayedStock.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/50 transition group">
                                        <td className="px-6 py-4 text-sm font-bold text-slate-700">{item.name}</td>
                                        <td className="px-6 py-4 text-center"><span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${item.current_quantity <= 0 ? 'bg-red-100 text-red-800' : item.current_quantity < item.min_alert_quantity ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>{item.current_quantity <= 0 ? 'หมด' : item.current_quantity < item.min_alert_quantity ? 'ใกล้หมด' : 'ปกติ'}</span></td>
                                        <td className="px-6 py-4 text-sm text-right font-mono font-bold text-slate-800 text-lg">{item.current_quantity} <span className="text-xs text-slate-400 font-sans font-normal ml-1">{item.unit}</span></td>
                                        <td className="px-6 py-4 text-center flex justify-center gap-2">
                                            <button onClick={() => setSelectedProductForAction({ id: item.productId, name: item.name })} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-500 hover:text-white transition shadow-sm" title="ใช้ของ">📉 ใช้ของ</button>
                                            <button onClick={() => setConfirmDeleteStock({ id: item.id, name: item.name })} className="p-2 text-slate-300 hover:text-slate-500 hover:bg-slate-100 rounded-lg transition" title="ลบรายการ">🗑️</button>
                                        </td>
                                    </tr>
                                )) : (<tr><td colSpan={4} className="p-10 text-center text-slate-400">ไม่พบข้อมูลสินค้า</td></tr>)}
                            </tbody>
                        </table>
                    </>
                )}

                {/* Tab 2: Summary (แบบใหม่) */}
                {activeTab === 'summary' && (
                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* รายวัน */}
                        <div className="bg-white rounded-2xl border border-indigo-100 overflow-hidden">
                            <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex justify-between items-center"><h3 className="font-bold text-indigo-700">📅 วันนี้</h3><span className="text-xs text-indigo-500 font-bold">{new Date().toLocaleDateString('th-TH')}</span></div>
                            <div className="p-4 max-h-[400px] overflow-y-auto custom-scrollbar">
                                {summary.today.length === 0 ? <div className="text-center py-8 text-slate-400">ไม่มีรายการเคลื่อนไหว</div> : 
                                summary.today.map((item, i) => (
                                    <div key={i} className="flex justify-between items-center py-3 border-b border-slate-100 last:border-0">
                                        <div className="flex flex-col"><span className="text-slate-700 font-bold">{item.name}</span><span className="text-xs text-slate-400">หน่วย: {item.unit}</span></div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex flex-col items-end pr-3 border-r border-slate-200"><span className="text-[10px] text-slate-400 uppercase tracking-wider">คงเหลือ</span><span className="font-mono text-lg font-bold text-slate-700">{item.remaining}</span></div>
                                            <div className="flex flex-col gap-1 min-w-[70px]">
                                                <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${item.received > 0 ? 'bg-green-100 text-green-700' : 'opacity-0'}`}><span>รับ</span><span>+{item.received}</span></div>
                                                <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${item.used > 0 ? 'bg-red-100 text-red-700' : 'opacity-0'}`}><span>ใช้</span><span>-{item.used}</span></div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* รายเดือน */}
                        <div className="bg-white rounded-2xl border border-orange-100 overflow-hidden">
                            <div className="bg-orange-50 p-4 border-b border-orange-100 flex justify-between items-center"><h3 className="font-bold text-orange-700">🗓️ เดือนนี้</h3><span className="text-xs text-orange-500 font-bold">Accumulated</span></div>
                            <div className="p-4 max-h-[400px] overflow-y-auto custom-scrollbar">
                                {summary.month.length === 0 ? <div className="text-center py-8 text-slate-400">ไม่มีรายการเคลื่อนไหว</div> : 
                                summary.month.map((item, i) => (
                                    <div key={i} className="flex justify-between items-center py-3 border-b border-slate-100 last:border-0">
                                        <div className="flex flex-col"><span className="text-slate-700 font-bold">{item.name}</span><span className="text-xs text-slate-400">หน่วย: {item.unit}</span></div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex flex-col items-end pr-3 border-r border-slate-200"><span className="text-[10px] text-slate-400 uppercase tracking-wider">คงเหลือ</span><span className="font-mono text-lg font-bold text-slate-700">{item.remaining}</span></div>
                                            <div className="flex flex-col gap-1 min-w-[70px]">
                                                <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${item.received > 0 ? 'bg-green-100 text-green-700' : 'opacity-0'}`}><span>รับ</span><span>+{item.received}</span></div>
                                                <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${item.used > 0 ? 'bg-red-100 text-red-700' : 'opacity-0'}`}><span>ใช้</span><span>-{item.used}</span></div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Tab 3: History (แบบละเอียด) */}
                {activeTab === 'history' && (
                    <div className="p-6">
                        <div className="relative mb-4">
                            <input 
                                type="text" placeholder="🔍 ค้นหาประวัติ..." 
                                className="w-full p-3 pl-10 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
                            />
                            <span className="absolute left-3 top-3.5 text-slate-400">📜</span>
                        </div>
                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                            {displayedHistory.length === 0 ? <div className="text-center py-10 text-slate-400 border-2 border-dashed rounded-xl">ไม่พบประวัติรายการ</div> : 
                            displayedHistory.map((txn) => (
                                <div key={txn.id} className="flex justify-between items-center p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${txn.type === 'ADD' ? 'bg-green-100 text-green-600' : txn.type === 'REMOVE' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                            {txn.type === 'ADD' ? '📥' : txn.type === 'REMOVE' ? '📤' : '↩️'}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-700 text-sm">
                                                {txn.type === 'ADD' ? 'รับของเข้า' : txn.type === 'REMOVE' ? 'เบิกของออก' : 'กู้คืนรายการ'}
                                                <span className="ml-2 text-indigo-600 font-bold">{txn.products?.name}</span>
                                            </p>
                                            <div className="flex gap-2 text-xs text-slate-400 mt-0.5">
                                                <span>📅 {new Date(txn.created_at).toLocaleDateString('th-TH')}</span>
                                                <span>🕒 {new Date(txn.created_at).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                                                <span>👤 โดย: {txn.performed_by}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <span className={`font-bold font-mono text-lg ${txn.type === 'ADD' || txn.type === 'RESTORE' ? 'text-green-600' : 'text-red-600'}`}>
                                        {txn.type === 'ADD' || txn.type === 'RESTORE' ? '+' : '-'}{txn.quantity_change} {txn.products?.unit}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
            {selectedProductForAction && branch && (<StockActionModal onClose={() => setSelectedProductForAction(null)} onSuccess={fetchData} branchId={branch.id} productId={selectedProductForAction.id} productName={selectedProductForAction.name} loginCode={branch.login_code} />)}
            {isRecycleBinOpen && branch && (<RecycleBinModal branchId={branch.id} onClose={() => setIsRecycleBinOpen(false)} onSuccess={fetchData} />)}
            {isOrderModalOpen && branch && (<OrderRequestModal branchId={branch.id} onClose={() => setIsOrderModalOpen(false)} onSuccess={() => { fetchData(); setSuccessModal({ show: true, message: 'ส่งคำขอเรียบร้อย! รอแอดมินอนุมัติ' }); }} />)}
            
            {/* Confirm / Success Modals */}
            {confirmReceiveOrder && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-fade-in">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmReceiveOrder(null)}></div>
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden animate-slide-up">
                        <div className="bg-green-600 p-6 text-white text-center"><div className="text-5xl mb-2">📦</div><h3 className="text-xl font-bold">ยืนยันรับสินค้า</h3></div>
                        <div className="p-6 bg-slate-50">
                            <p className="text-center text-slate-600 mb-4 text-sm">ได้รับของครบตามรายการนี้แล้วใช่ไหม?</p>
                            <ul className="bg-white p-4 rounded-xl border border-slate-200 space-y-2 text-sm text-slate-700 mb-6 max-h-40 overflow-y-auto">
                                {confirmReceiveOrder.order_items.map((item, i) => (<li key={i} className="flex justify-between border-b border-slate-100 last:border-0 pb-1"><span>{item.products.name}</span><span className="font-bold">{item.quantity} {item.products.unit}</span></li>))}
                            </ul>
                            <div className="flex gap-3"><button onClick={() => setConfirmReceiveOrder(null)} className="flex-1 py-3 rounded-xl bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">ยกเลิก</button><button onClick={handleConfirmReceive} className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 shadow-lg shadow-green-200">✅ ยืนยันรับของ</button></div>
                        </div>
                    </div>
                </div>
            )}

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

            {confirmDeleteStock && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteStock(null)}></div>
                    <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl relative z-10 p-6 text-center animate-slide-up">
                        <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">⚠️</span></div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">ลบรายการสินค้า?</h3>
                        <p className="text-slate-500 text-sm mb-6">คุณต้องการลบ <strong>"{confirmDeleteStock.name}"</strong> ออกจากหน้านี้ใช่ไหม? <br/>(กู้คืนได้ในถังขยะ)</p>
                        <div className="flex gap-3"><button onClick={() => setConfirmDeleteStock(null)} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200">ยกเลิก</button><button onClick={handleDeleteItem} className="flex-1 py-3 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-600 shadow-lg shadow-orange-200">ยืนยันลบ</button></div>
                    </div>
                </div>
            )}

            {successModal.show && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSuccessModal({ show: false, message: '' })}></div>
                    <div className="bg-white rounded-3xl shadow-2xl p-8 relative z-10 flex flex-col items-center max-w-sm w-full text-center animate-bounce-in">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 text-4xl animate-ping-once">🎉</div>
                        <h3 className="text-2xl font-bold text-slate-800 mb-2">สำเร็จ!</h3>
                        <p className="text-slate-500 mb-6">{successModal.message}</p>
                        <button onClick={() => setSuccessModal({ show: false, message: '' })} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition transform active:scale-95">ตกลง</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BranchStock;