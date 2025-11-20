import React from 'react';

// Type สำหรับสินค้าที่ใกล้หมด
export type LowStockItem = {
    id: number;
    branch_name: string;
    product_name: string;
    current_quantity: number;
    min_alert: number;
    unit: string;
};

const StockAlerts: React.FC<{ items: LowStockItem[] }> = ({ items }) => {

    return (
        <div className="bg-white rounded-2xl shadow-md border border-red-100 overflow-hidden h-full flex flex-col">
            <div className="bg-red-50 p-4 border-b border-red-100 flex items-center justify-between">
                <h3 className="font-bold text-red-700 flex items-center">
                    🚨 สินค้าใกล้หมด / หมด
                </h3>
                {items.length > 0 && (
                    <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full font-bold animate-pulse">
                        {items.length} รายการ
                    </span>
                )}
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 max-h-[350px] custom-scrollbar">
                {items.length > 0 ? (
                    <ul className="space-y-3">
                        {items.map((item, i) => (
                            <li key={i} className="flex flex-col p-3 bg-red-50/50 rounded-xl border border-red-100 hover:bg-red-50 transition">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <span className="text-xs font-bold text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-md mb-1 inline-block">
                                            {item.branch_name}
                                        </span>
                                        <p className="font-bold text-gray-800 text-lg">{item.product_name}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className={`text-xl font-bold ${item.current_quantity === 0 ? 'text-red-600' : 'text-orange-500'}`}>
                                            {item.current_quantity}
                                        </p>
                                        <span className="text-xs text-gray-500">{item.unit}</span>
                                    </div>
                                </div>
                                <div className="mt-2 pt-2 border-t border-red-100/50 flex justify-between items-center text-xs">
                                    <span className="text-red-400">
                                        {item.current_quantity === 0 ? 'สินค้าหมดสต็อก!' : 'ต่ำกว่าเกณฑ์'}
                                    </span>
                                    <span className="text-gray-400">เกณฑ์เตือน: {item.min_alert}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm py-10">
                        <span className="text-4xl mb-3">👍</span>
                        <p>เยี่ยมมาก! สต็อกสินค้าเพียงพอ</p>
                        <p className="text-xs mt-1 opacity-70">ไม่มีรายการที่ต่ำกว่าเกณฑ์แจ้งเตือน</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StockAlerts;