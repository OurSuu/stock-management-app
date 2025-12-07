import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

// Helper: Format date string (in UTC or ISO format) into Thai date+time using device timezone (assume client in Thailand)
function formatThaiDateTime(utcDateStr: string) {
    if (!utcDateStr) return '';
    // Create date object (assumes ISO string, ex: "2024-04-26T09:00:00.000Z")
    const date = new Date(utcDateStr);

    // Format using device's (Thailand) local time zone, not manual UTC+7
    // This will show correct time if user's computer is in time zone Asia/Bangkok (UTC+7)
    // If you want to force Asia/Bangkok time regardless of device locale, use Intl.DateTimeFormat with a timeZone.
    try {
        const thDate = new Intl.DateTimeFormat('th-TH', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            timeZone: 'Asia/Bangkok'
        }).format(date);

        const thTime = new Intl.DateTimeFormat('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Bangkok'
        }).format(date);

        return `${thDate} เวลา ${thTime}`;
    } catch (e) {
        // fallback: just show raw date
        return date.toLocaleString('th-TH');
    }
}

const AdminOrderManager: React.FC<{ onUpdate?: () => void }> = ({ onUpdate }) => {
    const [orders, setOrders] = useState<any[]>([]);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [confirmingOrder, setConfirmingOrder] = useState<any | null>(null);

    // สำหรับ input[type=date]
    const deliveryDateInputRef = useRef<HTMLInputElement>(null);

    // For pop up alerts/modals
    const [popup, setPopup] = useState<{
        show: boolean;
        type: 'alert' | 'confirm' | 'error';
        title?: string;
        message: string;
        onConfirm?: () => void;
        onCancel?: () => void;
    }>({ show: false, type: 'alert', message: '' });

    const fetchOrders = async () => {
        const { data } = await supabase
            .from('orders')
            .select(`*, branches(branch_name), order_items(quantity, products(name, unit))`)
            .eq('status', 'PENDING')
            .order('created_at', { ascending: true });
        setOrders(data || []);
    };

    useEffect(() => { fetchOrders(); }, []);

    // เปิด Modal เมื่อกดปุ่มอนุมัติ
    const handleOpenApproveModal = (order: any) => {
        setConfirmingOrder(order);
        setDeliveryDate('');
        setTimeout(() => {
            deliveryDateInputRef.current?.blur(); // reset autofocus, then re-focus
            deliveryDateInputRef.current?.focus();
        }, 100);
    };

    // ยืนยันการอนุมัติ
    const handleConfirmApprove = async () => {
        if (!confirmingOrder) return;
        if (!deliveryDate) {
            setPopup({
                show: true,
                type: 'alert',
                title: 'กรุณาระบุวันที่จัดส่งจริง',
                message: 'โปรดกรอกวันที่ของจะไปถึงก่อนดำเนินการต่อ',
                onConfirm: () => setPopup(prev => ({ ...prev, show: false })),
            });
            return;
        }
        try {
            const { error } = await supabase
                .from('orders')
                .update({
                    status: 'IN_TRANSIT',
                    delivery_date: deliveryDate,
                    approved_by: 'admin'
                })
                .eq('id', confirmingOrder.id);

            if (error) throw error;

            setConfirmingOrder(null);
            fetchOrders();
            if (onUpdate) onUpdate();
        } catch (err: any) {
            setPopup({
                show: true,
                type: 'error',
                title: 'เกิดข้อผิดพลาด',
                message: 'Error: ' + err.message,
                onConfirm: () => setPopup(prev => ({ ...prev, show: false })),
            });
        }
    };

    // ปฏิเสธคำขอ (popup ยืนยัน)
    const handleReject = async (orderId: string) => {
        setPopup({
            show: true,
            type: 'confirm',
            title: 'ยืนยันการปฏิเสธ',
            message: 'คุณแน่ใจหรือไม่ที่จะปฏิเสธคำขอนี้?',
            onConfirm: async () => {
                setPopup(prev => ({ ...prev, show: false }));
                await supabase.from('orders').update({ status: 'REJECTED' }).eq('id', orderId);
                fetchOrders();
            },
            onCancel: () => setPopup(prev => ({ ...prev, show: false })),
        });
    };

    // Popup Modal
    const PopupModal = ({ show, type, message, title, onConfirm, onCancel }: typeof popup) => {
        if (!show) return null;
        let icon;
        if (type === 'error') icon = <span className="text-3xl text-red-500">❌</span>;
        else if (type === 'confirm') icon = <span className="text-3xl text-yellow-400">🛑</span>;
        else icon = <span className="text-3xl text-blue-400">ℹ️</span>;
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 animate-fade-in">
                <div className="absolute inset-0" onClick={onCancel || onConfirm}></div>
                <div className="bg-white max-w-xs w-full rounded-3xl shadow-2xl z-10 p-6 text-center animate-slide-up">
                    <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        {icon}
                    </div>
                    {title && <h3 className="text-lg font-bold text-slate-800 mb-2">{title}</h3>}
                    <div className="text-slate-500 text-sm mb-6 whitespace-pre-line">{message}</div>
                    <div className="flex gap-3">
                        {type === 'confirm' ? (
                            <>
                                <button
                                    className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition"
                                    onClick={onCancel}
                                >
                                    ยกเลิก
                                </button>
                                <button
                                    className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 shadow transition active:scale-95"
                                    onClick={onConfirm}
                                >
                                    ยืนยัน
                                </button>
                            </>
                        ) : (
                            <button
                                className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition"
                                onClick={onConfirm}
                            >
                                ปิด
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // ฟังก์ชันช่วยให้เลือกวันใน input[type="date"] ได้ง่ายขึ้นบนมือถือ
    const handleOpenDatePicker = () => {
        deliveryDateInputRef.current?.showPicker && deliveryDateInputRef.current?.showPicker();
        deliveryDateInputRef.current?.focus();
    };

    // หาวันที่ minimal (คือวันนี้)
    function getToday() {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    return (
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 h-full">
            {/* Pop up modal */}
            <PopupModal {...popup} />

            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    🔔 คำขอรออนุมัติ <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">{orders.length}</span>
                </h2>
            </div>

            <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                {orders.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                        <p>ไม่มีคำขอใหม่</p>
                    </div>
                ) : orders.map((order) => (
                    <div key={order.id} className="border border-slate-200 rounded-xl p-4 hover:shadow-md transition bg-white relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-yellow-400"></div>
                        <div className="flex justify-between items-start mb-3 pl-3">
                            <div>
                                <h3 className="font-bold text-indigo-700 text-lg">{order.branches?.branch_name}</h3>
                                <p className="text-xs text-slate-500">
                                    ขอรับวันที่: {new Date(order.requested_date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}
                                </p>
                                {/* Show time of when the request was made, in Thai time */}
                                <p className="text-xs text-slate-400 mt-1">
                                    ขอเมื่อ: {formatThaiDateTime(order.created_at)}
                                </p>
                            </div>
                            <span className="bg-yellow-100 text-yellow-700 text-[10px] px-2 py-1 rounded-full font-bold">PENDING</span>
                        </div>

                        <div className="flex justify-between items-center mt-4 pl-3">
                            <span className="text-xs text-slate-400">{order.order_items.length} รายการสินค้า</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleReject(order.id)}
                                    className="px-3 py-1.5 text-slate-400 hover:text-red-600 text-xs font-bold transition"
                                >
                                    ปฏิเสธ
                                </button>
                                <button
                                    onClick={() => handleOpenApproveModal(order)}
                                    className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-xs font-bold shadow-md transition transform hover:-translate-y-0.5"
                                >
                                    ตรวจสอบ & อนุมัติ
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ✨ Modal ยืนยันการอนุมัติ (Pop-up) ✨ */}
            {confirmingOrder && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmingOrder(null)}></div>
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden animate-slide-up">
                        {/* Header */}
                        <div className="bg-indigo-600 p-6 text-white">
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                ✅ ยืนยันการอนุมัติ
                            </h3>
                            <p className="text-indigo-200 text-sm">ตรวจสอบรายการของ {confirmingOrder.branches?.branch_name}</p>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* รายการสินค้าสรุป */}
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <p className="text-xs font-bold text-slate-500 mb-2 uppercase">รายการสินค้าที่ขอเบิก</p>
                                <ul className="space-y-2 text-sm text-slate-700 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                    {confirmingOrder.order_items.map((item: any, idx: number) => (
                                        <li key={idx} className="flex justify-between border-b border-slate-200 last:border-0 pb-1">
                                            <span>{item.products?.name}</span>
                                            <span className="font-bold text-indigo-600">{item.quantity} {item.products?.unit}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* เลือกวันที่ส่ง */}
                            <div>
                                <label
                                    className="block text-sm font-bold text-slate-700 mb-2"
                                    htmlFor="delivery-date-picker"
                                >
                                    🚚 กำหนดวันที่ของจะไปถึง (Delivery Date)
                                </label>
                                <div
                                    className="relative"
                                >
                                    <input
                                        id="delivery-date-picker"
                                        ref={deliveryDateInputRef}
                                        type="date"
                                        className="w-full p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none font-medium text-slate-700 cursor-pointer"
                                        value={deliveryDate}
                                        min={getToday()}
                                        onChange={e => setDeliveryDate(e.target.value)}
                                        onFocus={e => e.currentTarget.showPicker && e.currentTarget.showPicker()}
                                    />
                                    <button
                                        type="button"
                                        className="absolute inset-y-0 right-2 flex items-center px-1 text-slate-500 hover:text-green-600 bg-transparent border-0"
                                        tabIndex={-1}
                                        aria-label="เปิดเลือกวันที่"
                                        onClick={handleOpenDatePicker}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20">
                                            <path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zm0-13H5V6h14v1z"/>
                                        </svg>
                                    </button>
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    * วันที่สาขาขอมาคือ: {new Date(confirmingOrder.requested_date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}
                                </p>
                                <p className="text-xs text-slate-400">
                                    * ส่งคำขอนี้เมื่อ: {formatThaiDateTime(confirmingOrder.created_at)}
                                </p>
                            </div>

                            {/* ปุ่ม Action */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setConfirmingOrder(null)}
                                    className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition"
                                >
                                    ยกเลิก
                                </button>
                                <button
                                    onClick={handleConfirmApprove}
                                    className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 shadow-lg shadow-green-200 transition transform active:scale-95"
                                >
                                    ยืนยันส่งของ
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default AdminOrderManager;