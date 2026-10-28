import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute, ModuleGuard } from '@/components/layout/Guards'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/Login'
import { DashboardPage } from '@/pages/Dashboard'
import { POSPage } from '@/pages/POS'
import { OrdersPage } from '@/pages/Orders'
import { NewOrderPage } from '@/pages/NewOrder'
import { OrderDetailPage } from '@/pages/OrderDetail'
import { InventoryPage } from '@/pages/Inventory'
import { PromotionsPage } from '@/pages/Promotions'
import { CustomersPage } from '@/pages/Customers'
import { PurchasesPage } from '@/pages/Purchases'
import { CashPage } from '@/pages/Cash'
import { ReceivablesPage } from '@/pages/Receivables'
import { ReportsPage } from '@/pages/Reports'
import { AuditPage } from '@/pages/Audit'
import { SettingsPage } from '@/pages/Settings'
import { NotFoundPage } from '@/pages/NotFound'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={
            <ModuleGuard module="dashboard">
              <DashboardPage />
            </ModuleGuard>
          }
        />
        <Route
          path="pos"
          element={
            <ModuleGuard module="pos">
              <POSPage />
            </ModuleGuard>
          }
        />
        <Route
          path="ordenes"
          element={
            <ModuleGuard module="orders">
              <OrdersPage />
            </ModuleGuard>
          }
        />
        <Route
          path="ordenes/nueva"
          element={
            <ModuleGuard module="orders">
              <NewOrderPage />
            </ModuleGuard>
          }
        />
        <Route
          path="ordenes/:id"
          element={
            <ModuleGuard module="orders">
              <OrderDetailPage />
            </ModuleGuard>
          }
        />
        <Route
          path="inventario"
          element={
            <ModuleGuard module="inventory">
              <InventoryPage />
            </ModuleGuard>
          }
        />
        <Route
          path="promociones"
          element={
            <ModuleGuard module="promotions">
              <PromotionsPage />
            </ModuleGuard>
          }
        />
        <Route
          path="clientes"
          element={
            <ModuleGuard module="customers">
              <CustomersPage />
            </ModuleGuard>
          }
        />
        <Route
          path="compras"
          element={
            <ModuleGuard module="purchases">
              <PurchasesPage />
            </ModuleGuard>
          }
        />
        <Route
          path="caja"
          element={
            <ModuleGuard module="cash">
              <CashPage />
            </ModuleGuard>
          }
        />
        <Route
          path="cartera"
          element={
            <ModuleGuard module="receivables">
              <ReceivablesPage />
            </ModuleGuard>
          }
        />
        <Route
          path="reportes"
          element={
            <ModuleGuard module="reports">
              <ReportsPage />
            </ModuleGuard>
          }
        />
        <Route
          path="auditoria"
          element={
            <ModuleGuard module="audit">
              <AuditPage />
            </ModuleGuard>
          }
        />
        <Route
          path="configuracion"
          element={
            <ModuleGuard module="settings">
              <SettingsPage />
            </ModuleGuard>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
