import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

// เพิ่ม category
type ProductOption = { id: string; name: string; unit: string; category?: string };

// ฟังก์ชันเพื่อดึงเวลาปัจจุบันของไทย
function getCurrentThaiDateTime() {
    const thaiDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    return thaiDate;
}

// แปลง Date ให้อยู่ในรูป YYYY-MM-DD (เพื่อ <input type="date">)
function dateToDateInputString(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// แปลงวันที่และเวลาไทยเป็น format สวยงาม (เช่น 25 เม.ย. 2567 13:55)
function formatThaiDateTime(date: Date) {
    const months = [
        "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
        "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
    ];
    const dateStr = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${dateStr} ${hh}:${mm}`;
}

// Utility to generate selectable next N days options (starting today)
function getNextAvailableDates(n: number = 7) {
    const dates = [];
    const now = getCurrentThaiDateTime();
    for (let i = 0; i < n; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        dates.push({
            value: dateToDateInputString(d),
            label:
                i === 0
                    ? `วันนี้ (${formatThaiDateTime(d).split(" ")[0]} ${formatThaiDateTime(d).split(" ")[1]})`
                    : i === 1
                    ? `พรุ่งนี้ (${formatThaiDateTime(d).split(" ")[0]} ${formatThaiDateTime(d).split(" ")[1]})`
                    : formatThaiDateTime(d).split(" ").slice(0, 2).join(" "),
        });
    }
    return dates;
}

// Inline Popup Component
const PopupModal: React.FC<{
    open: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
}> = ({ open, onClose, title, children }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 animate-fade-in">
            <div className="absolute inset-0" onClick={onClose}></div>
            <div className="relative bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 px-8 border-t-8 border-blue-500">
                <div className="flex flex-col items-center text-center">
                    <div className="mb-2 text-blue-500 text-5xl">⚠️</div>
                    {title && <div className="text-xl font-bold mb-3 text-blue-700">{title}</div>}
                    <div>{children}</div>
                </div>
                <button
                    className="mt-6 w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow hover:shadow-lg transition"
                    onClick={onClose}
                    autoFocus
                >
                    ตกลง
                </button>
            </div>
        </div>
    );
};

// แก้ CATEGORY_LABELS ตรงนี้ ให้ตรงกับ category เดิม (supplies → glass, ingredients → ingredient)
const CATEGORY_LABELS: { [key: string]: string } = {
    'supplies': 'แก้ว',
    'ingredients': 'วัตถุดิบ'
};
// หมายเหตุ: key ที่ใช้ filter ต่อไปนี้ควรตรงกับค่าที่ได้จากฐานข้อมูล

const OrderRequestModal: React.FC<{
    branchId: string;
    onClose: () => void;
    onSuccess: () => void;
}> = ({ branchId, onClose, onSuccess }) => {
    const [products, setProducts] = useState<ProductOption[]>([]);
    const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
    const [requestDate, setRequestDate] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [showMissingDateModal, setShowMissingDateModal] = useState(false);
    const [thaiNow, setThaiNow] = useState<Date>(getCurrentThaiDateTime());
    const dateSelectRef = useRef<HTMLSelectElement>(null);

    useEffect(() => {
        const interval = setInterval(() => setThaiNow(getCurrentThaiDateTime()), 10000);
        return () => clearInterval(interval);
    }, []);

    // โหลดสินค้าทั้งหมด (category จากฐานข้อมูล: supplies, ingredients)
    useEffect(() => {
        const fetchProducts = async () => {
            const { data } = await supabase.from('products').select('id, name, unit, category').order('name');
            if (data) {
                const productsWithCategory = data.map((p: any) => ({
                    ...p,
                    category: p.category ? p.category : 'other',
                }));
                setProducts(productsWithCategory);
                const initialQty: { [key: string]: number } = {};
                productsWithCategory.forEach(p => { initialQty[p.id] = 0; });
                setQuantities(initialQty);
            }
        };
        fetchProducts();
    }, []);

    // ปรับจำนวน (+/-) - ไม่มี 0 นำหน้าแน่เพราะเราใช้จำนวนเต็ม
    const adjustQty = (id: string, delta: number) => {
        setQuantities(prev => {
            const nextQty = Math.max(0, (prev[id] || 0) + delta);
            return {
                ...prev,
                [id]: nextQty
            };
        });
    };

    // เปลี่ยนค่าตัวเลข input (ไม่มี 0 นำหน้า)
    const handleQtyInputChange = (id: string, value: string) => {
        // ลบ 0 นำหน้า & แปลงเป็นเลขจำนวนเต็ม
        let sanitizedValue = value.replace(/^0+/, '');
        // support เคสที่ input ล้างช่อง กลายเป็น "" ให้ set 0
        let num = sanitizedValue === '' ? 0 : parseInt(sanitizedValue, 10);
        if (isNaN(num) || num < 0) num = 0;
        setQuantities(prev => ({
            ...prev,
            [id]: num
        }));
    };

    const receiveDateOptions = getNextAvailableDates(7);

    useEffect(() => {
        if (!requestDate && receiveDateOptions.length > 0) {
            setRequestDate(receiveDateOptions[0].value);
        }
        // eslint-disable-next-line
    }, [thaiNow]);

    const handleSubmit = async () => {
        if (!requestDate) {
            setShowMissingDateModal(true);
            return;
        }

        const itemsToOrder = products
            .filter(p => quantities[p.id] > 0)
            .map(p => ({
                product_id: p.id,
                quantity: quantities[p.id]
            }));

        if (itemsToOrder.length === 0) {
            alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
            return;
        }

        setIsSubmitting(true);
        try {
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    branch_id: branchId,
                    requested_date: requestDate,
                    status: 'PENDING'
                })
                .select().single();

            if (orderError) throw orderError;

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

    // กรองสินค้าตามหมวดหมู่และคำค้นหา
    const filteredProducts = products.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchCategory =
            categoryFilter === 'all'
                ? true
                : (p.category || 'other') === categoryFilter;
        return matchSearch && matchCategory;
    });

    // เอาเฉพาะหมวดหมู่ที่มีในฐานข้อมูล (supplies กับ ingredients)
    const categoriesInProducts = Array.from(
        new Set(products.map(p => (p.category ? p.category : 'other')))
    ).filter(cat => cat === 'supplies' || cat === 'ingredients');

    const totalSelectedItems = Object.values(quantities).filter(q => q > 0).length;

    return (
        <>
            {/* Popup Modal for missing date */}
            <PopupModal
                open={showMissingDateModal}
                onClose={() => setShowMissingDateModal(false)}
                title="กรุณาระบุวันที่รับของ"
            >
                <div className="text-slate-700 text-base">
                    โปรดเลือก <span className="font-bold text-blue-600">วันที่ต้องการรับของ</span> ก่อนกดยืนยันคำขอค่ะ
                </div>
            </PopupModal>

            <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 animate-fade-in">
                <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
                <div className="bg-white w-full max-w-md md:max-w-2xl rounded-3xl shadow-2xl relative z-10 flex flex-col max-h-[95vh] overflow-hidden">

                    {/* Header */}
                    <div className="bg-blue-600 p-4 md:p-6 text-white shrink-0 flex flex-col md:flex-row justify-between md:items-center gap-2 relative">
                        <div>
                            <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">🛒 สั่งสินค้าเข้าสาขา</h3>
                            <p className="text-blue-100 text-xs md:text-sm">เลือกสินค้าที่ต้องการเบิกจากรายการด้านล่าง</p>
                        </div>
                        <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition text-lg">
                            ✕
                        </button>
                        <div className="mt-2 md:mt-0 text-xs bg-white/10 rounded-xl px-3 py-2 text-blue-100 font-semibold flex flex-col">
                            <span>
                                <span className="font-bold">⏱ วันที่ร้องขอ: </span>
                                {formatThaiDateTime(thaiNow)}
                            </span>
                        </div>
                    </div>

                    {/* Controls Section (วันที่, หมวดหมู่ & ค้นหา) */}
                    <div className="p-2 sm:p-4 bg-white border-b border-slate-200 shrink-0 flex flex-col gap-2 md:gap-4 sm:flex-row">
                        <div className="flex-1 min-w-0">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">📅 วันที่รับของ</label>
                            <select
                                ref={dateSelectRef}
                                className="w-full p-2 md:p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700 text-sm"
                                value={requestDate}
                                onChange={e => setRequestDate(e.target.value)}
                            >
                                {receiveDateOptions.map(option => (
                                    <option value={option.value} key={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1 min-w-0">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">🔍 ค้นหาสินค้า</label>
                            <input
                                type="text"
                                placeholder="พิมพ์ชื่อสินค้า..."
                                className="w-full p-2 md:p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex-1 min-w-0">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">📂 หมวดหมู่</label>
                            <select
                                className="w-full p-2 md:p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700 text-sm"
                                value={categoryFilter}
                                onChange={e => setCategoryFilter(e.target.value)}
                            >
                                <option value="all">หมวดหมู่ทั้งหมด</option>
                                {categoriesInProducts.map(cat =>
                                    <option value={cat} key={cat}>{CATEGORY_LABELS[cat] || cat}</option>
                                )}
                            </select>
                        </div>
                    </div>

                    {/* Product List (Grouped by category, Scrollable) */}
                    <div className="flex-1 overflow-y-auto p-2 sm:p-4 bg-slate-50">
                        {filteredProducts.length === 0 &&
                            <div className="text-center text-slate-400 py-8">ไม่พบรายการสินค้า</div>
                        }
                        <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 gap-2 sm:gap-3">
                            {filteredProducts.map(product => {
                                const qty = quantities[product.id] || 0;
                                return (
                                    <div
                                        key={product.id}
                                        className={`p-2 sm:p-3 rounded-xl border-2 transition-all flex items-center justify-between ${qty > 0 ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-white bg-white shadow-sm'}`}
                                    >
                                        {/* ชื่อสินค้า */}
                                        <div className="flex-1 min-w-0 mr-2">
                                            <p className={`font-bold truncate ${qty > 0 ? 'text-blue-800' : 'text-slate-700'} text-base sm:text-lg`}>{product.name}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs text-slate-400">{product.unit}</span>
                                                {/* ใช้ CATEGORY_LABELS ตาม key จริงจากฐานข้อมูล (supplies/ingredients) */}
                                                {product.category && CATEGORY_LABELS[product.category] && (
                                                    <span className="text-xs text-blue-400 bg-blue-100 px-2 py-0.5 rounded-full">{CATEGORY_LABELS[product.category]}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Input + ปุ่มกด +/- */}
                                        <div className="flex items-center gap-1 bg-white rounded-lg shadow-sm border border-slate-100 p-1">
                                            <button
                                                onClick={() => adjustQty(product.id, -1)}
                                                className="w-8 h-8 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600 transition font-bold disabled:opacity-50 text-lg"
                                                disabled={qty === 0}
                                            >
                                                -
                                            </button>
                                            <input
                                                type="number"
                                                min={0}
                                                className="w-12 sm:w-16 text-center font-bold text-slate-800 text-base sm:text-lg px-1 py-1 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                value={qty}
                                                onChange={e => handleQtyInputChange(product.id, e.target.value)}
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                            />
                                            <button
                                                onClick={() => adjustQty(product.id, 1)}
                                                className="w-8 h-8 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-green-100 hover:text-green-600 transition font-bold text-lg"
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
                    <div className="p-3 sm:p-4 bg-white border-t border-slate-200 shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                        <div className="text-xs sm:text-sm">
                            <span className="text-slate-500">เลือกแล้ว:</span>
                            <strong className="ml-2 text-blue-600 text-lg sm:text-xl">{totalSelectedItems}</strong>
                            <span className="text-slate-400 ml-1">รายการ</span>
                        </div>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting || totalSelectedItems === 0}
                            className="w-full sm:w-auto px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition transform active:scale-95 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed text-base sm:text-lg"
                        >
                            {isSubmitting ? 'กำลังส่ง...' : '🚀 ยืนยันคำขอ'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default OrderRequestModal;