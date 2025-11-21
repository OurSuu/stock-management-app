import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

type ProductOption = { id: string; name: string; unit: string };

const OrderRequestModal: React.FC<{
    branchId: string;
    onClose: () => void;
    onSuccess: () => void;
}> = ({ branchId, onClose, onSuccess }) => {
    const [products, setProducts] = useState<ProductOption[]>([]);
    // ใช้ Object เก็บจำนวนสินค้า { "product_id": quantity }
    const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
    const [requestDate, setRequestDate] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // โหลดสินค้าทั้งหมด
    useEffect(() => {
        const fetchProducts = async () => {
            const { data } = await supabase.from('products').select('id, name, unit').order('name');
            if (data) {
                setProducts(data);
                // เริ่มต้นจำนวนเป็น 0 ทุกตัว
                const initialQty: { [key: string]: number } = {};
                data.forEach(p => { initialQty[p.id] = 0; });
                setQuantities(initialQty);
            }
        };
        fetchProducts();
    }, []);

    // ฟังก์ชันปรับจำนวน (+/-)
    const adjustQty = (id: string, delta: number) => {
        setQuantities(prev => ({
            ...prev,
            [id]: Math.max(0, (prev[id] || 0) + delta)
        }));
    };

    const handleSubmit = async () => {
        if (!requestDate) return alert('กรุณาระบุวันที่ต้องการรับของ');

        // กรองเอาเฉพาะตัวที่มีจำนวน > 0
        const itemsToOrder = products
            .filter(p => quantities[p.id] > 0)
            .map(p => ({
                product_id: p.id,
                quantity: quantities[p.id]
            }));

        if (itemsToOrder.length === 0) return alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');

        setIsSubmitting(true);
        try {
            // 1. สร้าง Order
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({ branch_id: branchId, requested_date: requestDate, status: 'PENDING' })
                .select().single();

            if (orderError) throw orderError;

            // 2. สร้าง Order Items
            const { error: itemsError } = await supabase.from('order_items').insert(
                itemsToOrder.map(item => ({ order_id: order.id, ...item }))
            );

            if (itemsError) throw itemsError;

            onSuccess();
            onClose();
        } catch (err: any) {
            alert('Error: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // กรองสินค้าตามคำค้นหา
    const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

    // นับจำนวนรายการที่เลือก
    const totalSelectedItems = Object.values(quantities).filter(q => q > 0).length;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 flex flex-col max-h-[90vh] overflow-hidden">

                {/* Header */}
                <div className="bg-blue-600 p-6 text-white shrink-0 flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2">🛒 สั่งสินค้าเข้าสาขา</h3>
                        <p className="text-blue-100 text-sm">เลือกสินค้าที่ต้องการเบิกจากรายการด้านล่าง</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition">✕</button>
                </div>

                {/* Controls Section (วันที่ & ค้นหา) */}
                <div className="p-4 bg-white border-b border-slate-200 shrink-0 flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">📅 วันที่รับของ</label>
                        <input
                            type="date"
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                            value={requestDate}
                            onChange={e => setRequestDate(e.target.value)}
                        />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">🔍 ค้นหาสินค้า</label>
                        <input
                            type="text"
                            placeholder="พิมพ์ชื่อสินค้า..."
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Product List (Scrollable) */}
                <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {filteredProducts.map(product => {
                            const qty = quantities[product.id] || 0;
                            return (
                                <div
                                    key={product.id}
                                    className={`p-3 rounded-xl border-2 transition-all flex items-center justify-between ${qty > 0 ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-white bg-white shadow-sm'}`}
                                >
                                    {/* ชื่อสินค้า */}
                                    <div className="flex-1 min-w-0 mr-2">
                                        <p className={`font-bold truncate ${qty > 0 ? 'text-blue-800' : 'text-slate-700'}`}>{product.name}</p>
                                        <p className="text-xs text-slate-400">{product.unit}</p>
                                    </div>

                                    {/* ปุ่มกด +/- */}
                                    <div className="flex items-center gap-1 bg-white rounded-lg shadow-sm border border-slate-100 p-1">
                                        <button
                                            onClick={() => adjustQty(product.id, -1)}
                                            className="w-8 h-8 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600 transition font-bold disabled:opacity-50"
                                            disabled={qty === 0}
                                        >
                                            -
                                        </button>
                                        <div className="w-10 text-center font-bold text-slate-800 text-lg">
                                            {qty}
                                        </div>
                                        <button
                                            onClick={() => adjustQty(product.id, 1)}
                                            className="w-8 h-8 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-green-100 hover:text-green-600 transition font-bold"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer (Summary & Submit) */}
                <div className="p-4 bg-white border-t border-slate-200 shrink-0 flex items-center justify-between">
                    <div className="text-sm">
                        <span className="text-slate-500">เลือกแล้ว:</span>
                        <strong className="ml-2 text-blue-600 text-xl">{totalSelectedItems}</strong>
                        <span className="text-slate-400 ml-1">รายการ</span>
                    </div>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || totalSelectedItems === 0}
                        className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition transform active:scale-95 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? 'กำลังส่ง...' : '🚀 ยืนยันคำขอ'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OrderRequestModal;