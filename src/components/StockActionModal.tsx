import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

type ProductOption = {
    id: string;
    name: string;
};

const StockActionModal: React.FC<{ 
    onClose: () => void; 
    onSuccess: () => void;
    branchId: string;
    loginCode: string;
}> = ({ onClose, onSuccess, branchId, loginCode }) => {
    const [products, setProducts] = useState<ProductOption[]>([]);
    const [selectedProduct, setSelectedProduct] = useState('');

    // ✅ แก้ไข 1: เปลี่ยน State ให้รองรับค่าว่าง '' ได้
    const [quantity, setQuantity] = useState<number | ''>(''); // เริ่มต้นเป็นค่าว่าง ให้กรอกง่ายๆ

    const [actionType, setActionType] = useState<'ADD' | 'REMOVE'>('REMOVE'); // เริ่มต้นเป็น 'เบิกออก' (เพราะใช้บ่อยกว่า)
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchProducts = async () => {
            const { data } = await supabase.from('products').select('id, name').order('name');
            if (data && data.length > 0) {
                setProducts(data);
                setSelectedProduct(data[0].id);
            }
        };
        fetchProducts();
    }, []);

    const handleAction = async () => {
        // ✅ แก้ไข 2: แปลงค่าว่างให้เป็น 0 ตอนกดส่ง และเช็คค่า
        const finalQty = quantity === '' ? 0 : quantity;

        if (!selectedProduct || finalQty <= 0) {
            setError('กรุณาระบุจำนวนสินค้า (ต้องมากกว่า 0)');
            return;
        }

        setIsSubmitting(true);
        setError('');

        try {
            // 1. บันทึกประวัติ (Transaction)
            const { error: txnError } = await supabase.from('transactions').insert({
                branch_id: branchId,
                product_id: selectedProduct,
                type: actionType,
                quantity_change: finalQty,
                performed_by: loginCode,
            });
            if (txnError) throw txnError;

            // 2. อัปเดตสต็อก
            const stockChange = actionType === 'ADD' ? finalQty : -finalQty;
            const { error: rpcError } = await supabase.rpc('update_stock_quantity', {
                p_branch_id: branchId,
                p_product_id: selectedProduct,
                p_quantity_change: stockChange,
            });
            if (rpcError) throw rpcError;

            onSuccess();
            onClose();
        } catch (err: any) {
            setError('เกิดข้อผิดพลาด: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-slide-up">
                <div className="bg-indigo-600 p-5 text-white flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-bold">ทำรายการสินค้า</h3>
                        <p className="text-indigo-200 text-sm">บันทึกการรับเข้า หรือ การใช้งาน</p>
                    </div>
                    <button onClick={onClose} className="text-white/80 hover:text-white text-2xl">&times;</button>
                </div>
                
                <div className="p-6 space-y-6">
                    {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-xl flex items-center">⚠️ {error}</div>}

                    {/* เลือกสินค้า */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">สินค้า</label>
                        <select
                            value={selectedProduct}
                            onChange={(e) => setSelectedProduct(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-800 font-medium"
                        >
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>

                    {/* ประเภทรายการ */}
                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => setActionType('ADD')}
                            className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-2 ${actionType === 'ADD' ? 'bg-green-50 border-green-500 text-green-700 shadow-sm' : 'bg-white border-slate-100 text-slate-400 hover:border-green-200'}`}
                        >
                            <span className="text-2xl">📥</span>
                            <span className="font-bold">รับของเข้า (เพิ่ม)</span>
                        </button>
                        <button
                            onClick={() => setActionType('REMOVE')}
                            className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-2 ${actionType === 'REMOVE' ? 'bg-red-50 border-red-500 text-red-700 shadow-sm' : 'bg-white border-slate-100 text-slate-400 hover:border-red-200'}`}
                        >
                            <span className="text-2xl">📤</span>
                            <span className="font-bold">บันทึกการใช้ (ลบ)</span>
                        </button>
                    </div>

                    {/* จำนวน (ช่องปัญหาเก่า แก้แล้ว!) */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">จำนวน</label>
                        <input
                            type="number"
                            min="0"
                            value={quantity}
                            onChange={(e) => {
                                const val = e.target.value;
                                // อนุญาตให้เป็นค่าว่าง หรือ ตัวเลข >= 0
                                if (val === '') setQuantity('');
                                else if (!isNaN(Number(val)) && Number(val) >= 0) setQuantity(Number(val));
                            }}
                            placeholder="ระบุจำนวน (เช่น 10)"
                            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-2xl text-center text-slate-800 placeholder:text-slate-300"
                        />
                    </div>

                    <button 
                        onClick={handleAction}
                        disabled={isSubmitting}
                        className="w-full py-4 rounded-xl bg-indigo-600 text-white font-bold text-lg hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition transform active:scale-95 disabled:opacity-70"
                    >
                        {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันรายการ'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StockActionModal;