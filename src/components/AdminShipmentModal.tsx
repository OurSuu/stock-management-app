import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type ProductOption = { id: string; name: string; unit: string };
type BranchOption = { id: string; branch_name: string };

const AdminShipmentModal: React.FC<{ 
    onClose: () => void; 
    onSuccess: () => void; 
}> = ({ onClose, onSuccess }) => {
    const { branch: adminUser } = useAuth(); // เอาชื่อ Admin มาใส่ในช่อง "ผู้ส่ง"
    
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [products, setProducts] = useState<ProductOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('');
    
    // ระบบตะกร้าสินค้า (Cart)
    const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
    
    const [deliveryDate, setDeliveryDate] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // โหลดข้อมูลเริ่มต้น
    useEffect(() => {
        const loadData = async () => {
            // 1. ดึงรายชื่อสาขา (ยกเว้น Admin เอง ถ้ามี)
            const { data: branchData } = await supabase.from('branches').select('id, branch_name').neq('role', 'admin').order('branch_name');
            if (branchData) setBranches(branchData);

            // 2. ดึงสินค้า
            const { data: productData } = await supabase.from('products').select('id, name, unit').order('name');
            if (productData) {
                setProducts(productData);
                const initialQty: any = {};
                productData.forEach(p => initialQty[p.id] = 0);
                setQuantities(initialQty);
            }
        };
        loadData();
    }, []);

    const adjustQty = (id: string, delta: number) => {
        setQuantities(prev => ({
            ...prev,
            [id]: Math.max(0, (prev[id] || 0) + delta)
        }));
    };

    const handleSubmit = async () => {
        if (!selectedBranch) return alert('กรุณาเลือกสาขาปลายทาง');
        if (!deliveryDate) return alert('กรุณาระบุวันที่ส่งของ');
        
        const itemsToSend = products
            .filter(p => quantities[p.id] > 0)
            .map(p => ({ product_id: p.id, quantity: quantities[p.id] }));

        if (itemsToSend.length === 0) return alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');

        setIsSubmitting(true);
        try {
            // 1. สร้าง Order แบบ "IN_TRANSIT" (กำลังส่ง) ทันที
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    branch_id: selectedBranch,
                    requested_date: deliveryDate, // วันที่ขอ = วันที่ส่ง (สำหรับเคส Admin ส่งเอง)
                    delivery_date: deliveryDate,
                    status: 'IN_TRANSIT',         // สถานะกำลังส่งเลย ไม่ต้องรออนุมัติ
                    approved_by: adminUser?.branch_name || 'Admin' // ระบุชื่อผู้ส่ง
                })
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. ใส่รายการสินค้า
            const { error: itemsError } = await supabase.from('order_items').insert(
                itemsToSend.map(item => ({ order_id: order.id, ...item }))
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

    const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const totalSelected = Object.values(quantities).filter(q => q > 0).length;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl relative z-10 flex flex-col max-h-[90vh] overflow-hidden">
                
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white shrink-0 flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2">🚚 ส่งสินค้าให้สาขา (Admin Push)</h3>
                        <p className="text-purple-100 text-sm">เลือกสาขาและสินค้าที่ต้องการจัดส่ง</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition">✕</button>
                </div>

                {/* Controls */}
                <div className="p-4 bg-white border-b border-slate-200 shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">🏢 ไปยังสาขา</label>
                        <select 
                            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none font-bold text-slate-700"
                            value={selectedBranch}
                            onChange={e => setSelectedBranch(e.target.value)}
                        >
                            <option value="">-- เลือกสาขา --</option>
                            {branches.map(b => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">📅 วันที่ส่งของ</label>
                        <input 
                            type="date" 
                            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none font-bold text-slate-700"
                            value={deliveryDate}
                            onChange={e => setDeliveryDate(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">🔍 ค้นหาสินค้า</label>
                        <input 
                            type="text" 
                            placeholder="พิมพ์ชื่อสินค้า..." 
                            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Product Grid */}
                <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filteredProducts.map(product => {
                            const qty = quantities[product.id] || 0;
                            return (
                                <div key={product.id} className={`p-3 rounded-xl border-2 transition-all flex items-center justify-between ${qty > 0 ? 'border-purple-500 bg-purple-50 shadow-sm' : 'border-white bg-white shadow-sm'}`}>
                                    <div className="flex-1 min-w-0 mr-2">
                                        <p className={`font-bold truncate ${qty > 0 ? 'text-purple-800' : 'text-slate-700'}`}>{product.name}</p>
                                        <p className="text-xs text-slate-400">{product.unit}</p>
                                    </div>
                                    <div className="flex items-center gap-1 bg-white rounded-lg shadow-sm border border-slate-100 p-1">
                                        <button onClick={() => adjustQty(product.id, -1)} className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600 font-bold disabled:opacity-50" disabled={qty === 0}>-</button>
                                        <div className="w-8 text-center font-bold text-slate-800">{qty}</div>
                                        <button onClick={() => adjustQty(product.id, 1)} className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-green-100 hover:text-green-600 font-bold">+</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-white border-t border-slate-200 shrink-0 flex items-center justify-between">
                    <div className="text-sm"><span className="text-slate-500">รวม:</span> <strong className="ml-1 text-purple-600 text-lg">{totalSelected}</strong> <span className="text-slate-400">รายการ</span></div>
                    <button onClick={handleSubmit} disabled={isSubmitting || totalSelected === 0} className="px-8 py-3 bg-purple-600 text-white rounded-xl font-bold shadow-lg shadow-purple-200 hover:bg-purple-700 transition transform active:scale-95 disabled:opacity-50">
                        {isSubmitting ? 'กำลังบันทึก...' : '🚀 ยืนยันการส่งของ'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminShipmentModal;