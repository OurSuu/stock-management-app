import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

const StockActionModal: React.FC<{
    onClose: () => void;
    onSuccess: () => void;
    branchId: string;
    productId: string;   // รับ ID สินค้ามาเลย ไม่ต้องเลือกใหม่
    productName: string; // รับชื่อมาโชว์
    loginCode: string;
}> = ({ onClose, onSuccess, branchId, productId, productName, loginCode }) => {
    const [quantity, setQuantity] = useState<number | ''>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleAction = async () => {
        const finalQty = quantity === '' ? 0 : quantity;

        if (finalQty <= 0) {
            setError('กรุณาระบุจำนวนที่ใช้ไป');
            return;
        }

        setIsSubmitting(true);
        setError('');

        try {
            // เรียกใช้ฟังก์ชัน Atomic ใน Database (ทำทีเดียวจบ)
            const { error: rpcError } = await supabase.rpc('perform_stock_transaction', {
                p_branch_id: branchId,
                p_product_id: productId,
                p_quantity_change: -finalQty, // ส่งค่าติดลบ (เพราะใช้ของ)
                p_type: 'REMOVE',             // ระบุประเภท
                p_performed_by: loginCode     // ระบุคนทำ
            });

            if (rpcError) throw rpcError;

            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message); // แสดงข้อความ Error จาก Database (เช่น ของไม่พอ)
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            ></div>
            <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-slide-up">
                <div className="bg-red-500 p-5 text-white flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold">บันทึกการใช้ของ</h3>
                        <p className="text-red-100 text-xs">ตัดสต็อก: {productName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white text-2xl"
                    >
                        &times;
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    {error && (
                        <div className="bg-red-50 text-red-600 text-sm p-3 rounded-xl flex items-center font-bold border border-red-100 animate-shake">
                            ⚠️ {error}
                        </div>
                    )}

                    <div className="space-y-2 text-center">
                        <label className="text-sm font-bold text-slate-700">ระบุจำนวนที่ใช้ไป</label>
                        <input
                            type="number"
                            min="0"
                            autoFocus
                            value={quantity}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') setQuantity('');
                                else if (!isNaN(Number(val)) && Number(val) >= 0)
                                    setQuantity(Number(val));
                            }}
                            placeholder="0"
                            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-red-200 outline-none font-mono text-4xl text-center text-red-600 font-bold placeholder:text-slate-300"
                        />
                    </div>

                    <button
                        onClick={handleAction}
                        disabled={isSubmitting}
                        className="w-full py-3.5 rounded-xl bg-red-500 text-white font-bold text-lg hover:bg-red-600 shadow-lg shadow-red-200 transition transform active:scale-95 disabled:opacity-70"
                    >
                        {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันตัดสต็อก'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StockActionModal;