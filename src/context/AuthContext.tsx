import React, { createContext, useContext, useState } from 'react';
import { supabase } from '../lib/supabase';

// 1. Define Types
type BranchInfo = {
  id: string;
  branch_name: string;
  login_code: string;
  role: 'admin' | 'branch'; // <--- เพิ่ม role เข้าไป
};

type AuthContextType = {
  isLoggedIn: boolean;
  branch: BranchInfo | null;
  isAdmin: boolean; // <--- เพิ่มตัวแปรช่วย
  login: (code: string, pass: string) => Promise<{ success: boolean; message: string }>;
  logout: () => void;
};

// 2. Create Context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 3. Provider Component
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [branch, setBranch] = useState<BranchInfo | null>(null);
  const isLoggedIn = !!branch;
  const isAdmin = branch?.role === 'admin';

  // 4. Login Logic - ดึง role มาด้วย
  const login = async (loginCode: string, password: string) => {
    // 1. Query Supabase เพื่อค้นหาสาขาที่ตรงกับ login_code และ password และดึง role มาด้วย
    const { data, error } = await supabase
      .from('branches')
      .select('id, branch_name, login_code, role') // <--- ดึง role เพิ่ม
      .eq('login_code', loginCode)
      .eq('password', password)
      .single();

    if (error || !data) {
      // ... จัดการ Error
      console.error('Login error:', error?.message || 'Branch not found or incorrect credentials.');
      return { success: false, message: 'รหัสสาขาหรือรหัสผ่านไม่ถูกต้อง' };
    }

    // 2. ถ้าสำเร็จ: 'id' จะถูกเก็บไว้ใน State ของ Context
    setBranch(data); // data มี 'id', 'role' ฯลฯ
    return { success: true, message: 'เข้าสู่ระบบสำเร็จ' };
  };

  const logout = () => {
    setBranch(null);
    // ล้างข้อมูล session ใน LocalStorage
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, branch, isAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// 5. Custom Hook for usage
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};