import React, { useState } from 'react';
import BranchDetailModal from './BranchDetailModal';

// Ensure the status is narrowed and avoid TS index errors
type StatusType = 'good' | 'warning' | 'critical';

const statusConfig: Record<StatusType, { color: string; label: string; icon: string }> = {
    good: { color: 'bg-green-100 text-green-700', label: 'ปกติ', icon: '✅' },
    warning: { color: 'bg-yellow-100 text-yellow-700', label: 'ควรตรวจสอบ', icon: '⚠️' },
    critical: { color: 'bg-red-100 text-red-700', label: 'วิกฤต', icon: '🔥' },
};

type BranchType = {
    id: string;
    branch_name: string;
    status: StatusType;
    total_stock_value: number;
    [key: string]: any; // allow extra keys from backend
};

const BranchCard: React.FC<{ branch: BranchType; hasDelivery?: boolean }> = ({ branch, hasDelivery }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Fallback to 'good' if status is not one of the allowed values
    const config = statusConfig[branch.status as StatusType] || statusConfig.good;

    return (
        <>
            <div
                onClick={() => setIsModalOpen(true)}
                className="bg-white rounded-2xl p-6 shadow-md hover:shadow-xl border border-gray-100 cursor-pointer transition-all duration-300 transform hover:-translate-y-2 group relative overflow-hidden"
            >
                {/* แถบสีด้านซ้ายตกแต่ง */}
                <div className={`absolute top-0 left-0 w-1.5 h-full ${
                    branch.status === 'good'
                        ? 'bg-green-500'
                        : branch.status === 'warning'
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                }`}></div>

                <div className="flex justify-between items-start mb-4">
                    <div className="bg-gray-100 p-3 rounded-xl group-hover:bg-indigo-100 transition-colors">
                        <span className="text-2xl">🏢</span>
                    </div>
                    <div className="flex gap-2">
                        {/* ไอคอนรถ แสดงเมื่อมีของกำลังส่ง */}
                        {hasDelivery && (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1 animate-pulse">
                                🚚 กำลังส่ง
                            </span>
                        )}
                        {/* Status Badge เดิม */}
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${config.color}`}>
                            {config.icon} {config.label}
                        </span>
                    </div>
                </div>

                <h3 className="text-xl font-bold text-gray-800 mb-1 group-hover:text-indigo-600 transition-colors">
                    {branch.branch_name}
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                    รหัสสาขา: #{typeof branch.id === 'string' && branch.id.length >= 4 ? branch.id.substring(0, 4) : branch.id}
                </p>

                <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-xs text-gray-400">ยอดคงเหลือรวม</span>
                    <span className="font-mono font-semibold text-gray-700">
                        {typeof branch.total_stock_value === 'number'
                            ? branch.total_stock_value.toLocaleString()
                            : '-'}{' '}
                        หน่วย
                    </span>
                </div>
            </div>

            {isModalOpen && (
                <BranchDetailModal
                    branchId={branch.id}
                    branchName={branch.branch_name}
                    onClose={() => setIsModalOpen(false)}
                />
            )}
        </>
    );
};

export default BranchCard;