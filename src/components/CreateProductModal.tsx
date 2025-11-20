import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

const CreateProductModal: React.FC<{ onClose: () => void; onSuccess: () => void }> = ({ onClose, onSuccess }) => {
    const [name, setName] = useState('');
    const [unit, setUnit] = useState('');
    const [minAlert, setMinAlert] = useState(10);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');

        try {
            const { error } = await supabase.from('products').insert({
                name: name,
                unit: unit,
                min_alert_quantity: minAlert
            });

            if (error) throw error;
            onSuccess();
            onClose();
        } catch (err: any) {
            setError('เพิ่มสินค้าไม่สำเร็จ: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 animate-slide-up overflow-hidden">
                
                {/* Header สีส้มสดใส ให้ต่างจากหน้าอื่น */}
                <div className="bg-orange-500 p-6 text-white">
                    <h2 className="text-xl font-bold">✨ เพิ่มวัตถุดิบใหม่</h2>
                    <p className="text-orange-100 text-sm">สร้างรายการสินค้ากลางเข้าสู่ระบบ</p>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
                    
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">ชื่อวัตถุดิบ</label>
                        <input 
                            type="text" required 
                            value={name} onChange={e => setName(e.target.value)} 
                            className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none" 
                            placeholder="เช่น นมข้นหวาน, แก้วพลาสติก" 
                        />
                    </div>
                    
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-bold text-gray-700 mb-1">หน่วยนับ</label>
                            <input 
                                type="text" required 
                                value={unit} onChange={e => setUnit(e.target.value)} 
                                className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none" 
                                placeholder="เช่น กระป๋อง, ใบ" 
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-bold text-gray-700 mb-1">เตือนเมื่อต่ำกว่า</label>
                            <input 
                                type="number" required min="0"
                                value={minAlert} onChange={e => setMinAlert(parseInt(e.target.value))} 
                                className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none" 
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-gray-100 rounded-xl font-bold text-gray-600 hover:bg-gray-200">ยกเลิก</button>
                        <button type="submit" disabled={isSubmitting} className="flex-1 py-3 bg-orange-500 rounded-xl font-bold text-white hover:bg-orange-600 shadow-lg shadow-orange-200">
                            {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันเพิ่มสินค้า'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateProductModal;