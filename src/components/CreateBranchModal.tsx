import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

const CreateBranchModal: React.FC<{ onClose: () => void; onSuccess: () => void }> = ({ onClose, onSuccess }) => {
    const [branchName, setBranchName] = useState('');
    const [loginCode, setLoginCode] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');

        try {
            const { error } = await supabase.from('branches').insert({
                branch_name: branchName,
                login_code: loginCode,
                password: password, // ในระบบจริงควร Hash ก่อน แต่เพื่อการเรียนรู้ใช้แบบนี้ไปก่อน
                role: 'branch' // สร้างเป็นสาขาปกติ
            });

            if (error) throw error;
            onSuccess();
            onClose();
        } catch (err: any) {
            setError('สร้างสาขาไม่สำเร็จ: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 animate-slide-up overflow-hidden">
                <div className="bg-gray-900 p-6 text-white">
                    <h2 className="text-xl font-bold">สร้างสาขาใหม่</h2>
                    <p className="text-gray-400 text-sm">กรอกข้อมูลเพื่อเพิ่มสาขาเข้าระบบ</p>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
                    
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">ชื่อสาขา</label>
                        <input type="text" required value={branchName} onChange={e => setBranchName(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="เช่น สาขาสยามพารากอน" />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">รหัสเข้าสู่ระบบ (Login Code)</label>
                        <input type="text" required value={loginCode} onChange={e => setLoginCode(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="เช่น SIAM01" />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">รหัสผ่าน</label>
                        <input type="text" required value={password} onChange={e => setPassword(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="กำหนดรหัสผ่านให้สาขา" />
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-gray-100 rounded-xl font-bold text-gray-600 hover:bg-gray-200">ยกเลิก</button>
                        <button type="submit" disabled={isSubmitting} className="flex-1 py-3 bg-indigo-600 rounded-xl font-bold text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200">{isSubmitting ? 'กำลังสร้าง...' : 'สร้างสาขา'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateBranchModal;