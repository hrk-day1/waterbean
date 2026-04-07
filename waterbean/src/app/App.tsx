import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ShellLayout } from "@/app/layouts/shell-layout";
import { PipelinePage } from "@/features/pipeline/view/pipeline-page";
import { SettingsPage } from "@/features/settings/view/settings-page";

export function App() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <BrowserRouter>
        <Routes>
          <Route element={<ShellLayout />}>
            <Route path="/" element={<Navigate to="/waterbean" replace />} />
            <Route path="/waterbean" element={<PipelinePage />} />
            <Route path="/setting" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </div>
  );
}
