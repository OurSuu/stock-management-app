import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const RecycleBinModal: React.FC<{ branchId: string; onClose: () => void; onSuccess: () => void }> = ({
    branchId,
    onClose,
    onSuccess,
}) => {
    const [displayItems, setDisplayItems] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [confirmRestore, setConfirmRestore] = useState<any | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const fetchData = async () => {
        setIsLoading(true);
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        try {
            // 1. ดึงรายการใช้ของ (REMOVE)
            const { data: removed } = await supabase
                .from('transactions')
                .select('*, products(name, unit)')
                .eq('branch_id', branchId)
                .eq('type', 'REMOVE')
                .gte('created_at', oneDayAgo)
                .order('created_at', { ascending: false });

            // 2. ดึงรายการกู้คืน (RESTORE) เพื่อดูว่าอันไหนกู้ไปแล้ว
            const { data: restored } = await supabase
                .from('transactions')
                .select('reference_id')
                .eq('branch_id', branchId)
                .eq('type', 'RESTORE')
                .gte('created_at', oneDayAgo);

            // เก็บ ID ที่ถูกกู้ไปแล้ว
            const restoredIds = new Set(restored?.map((r: any) => r.reference_id));

            // 3. กรองเอาเฉพาะที่ "ยังไม่ถูกกู้คืน" มาแสดง
            const activeItems = (removed || []).filter((item: any) => !restoredIds.has(item.id));

            setDisplayItems(activeItems);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const handleConfirmRestore = async () => {
        if (!confirmRestore || isProcessing) return;
        setIsProcessing(true);

        try {
            // เรียก RPC เพื่อคืนของ + สร้างประวัติ RESTORE + ผูก ID เดิม
            const { error } = await supabase.rpc('perform_stock_transaction', {
                p_branch_id: branchId,
                p_product_id: confirmRestore.product_id,
                p_quantity_change: confirmRestore.quantity_change, // บวกกลับ
                p_type: 'RESTORE',
                p_performed_by: confirmRestore.performed_by,
                p_reference_id: confirmRestore.id // ✅ สำคัญ: ผูกกับ ID เดิม
            });

            if (error) throw error;

            // อัปเดตหน้าจอ (ลบตัวที่กู้แล้วออก)
            setDisplayItems(prev => prev.filter(item => item.id !== confirmRestore.id));
            onSuccess();
            setConfirmRestore(null);
        } catch (err: any) {
            alert('Error: ' + err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative z-10 flex flex-col max-h-[80vh] overflow-hidden">
                <div className="p-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">↩️ ประวัติการใช้ (24 ชม.)</h3>
                        <p className="text-xs text-slate-500">รายการที่กู้คืนแล้วจะหายไปจากหน้านี้</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white hover:bg-slate-200 flex items-center justify-center transition">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
                    {isLoading ? (
                        <div className="text-center py-10 text-slate-400">กำลังโหลด...</div>
                    ) : displayItems.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 border-2 border-dashed rounded-xl">
                            ไม่มีรายการที่กู้คืนได้
                        </div>
                    ) : (
                        displayItems.map((item) => (
                            <div
                                key={item.id}
                                className="flex justify-between items-center p-4 bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition"
                            >
                                <div>
                                    <p className="font-bold text-slate-700">{item.products?.name}</p>
                                    <p className="text-xs text-slate-400">
                                        เวลา: {new Date(item.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-red-500 font-bold bg-red-50 px-2 py-1 rounded-lg">
                                        -{item.quantity_change} {item.products?.unit}
                                    </span>
                                    <button
                                        onClick={() => setConfirmRestore(item)}
                                        className="text-xs px-3 py-2 rounded-lg font-bold bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition"
                                    >
                                        คืนของ
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Modal ยืนยัน */}
            {confirmRestore && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-bounce-in">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => !isProcessing && setConfirmRestore(null)}
                    ></div>
                    <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl relative z-20 p-6 text-center">
                        <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">↩️</div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">ยืนยันคืนของ?</h3>
                        <p className="text-slate-600 text-sm mb-6">
                            คุณต้องการคืน <strong>{confirmRestore.products?.name}</strong> จำนวน {confirmRestore.quantity_change} กลับสต็อก?
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setConfirmRestore(null)}
                                disabled={isProcessing}
                                className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200"
                            >
                                ยกเลิก
                            </button>
                            <button
                                onClick={handleConfirmRestore}
                                disabled={isProcessing}
                                className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-lg"
                            >
                                {isProcessing ? 'กำลังคืน...' : 'ยืนยัน'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RecycleBinModal;