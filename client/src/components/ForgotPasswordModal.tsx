import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface ForgotPasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ForgotPasswordModal({ open, onClose }: ForgotPasswordModalProps) {
  const [employeeCode, setEmployeeCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setStatus('error');
      setMessage('Passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setStatus('error');
      setMessage('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);
    setStatus('idle');
    setMessage('');

    try {
      const response = await apiRequest('POST', '/api/auth/reset-password', {
        employeeCode,
        newPassword,
        confirmPassword,
      });

      if (response.ok) {
        setIsLoading(false);
        setStatus('success');
        setMessage('Your password has been updated successfully. A notification has been sent to your registered email.');
      }
    } catch (error: any) {
      setIsLoading(false);
      setStatus('error');
      
      let cleanMessage = 'Failed to update password. Please try again.';
      if (error instanceof Error) {
        const match = error.message.match(/^\d+:\s*(.*)$/);
        if (match) {
          try {
            const json = JSON.parse(match[1]);
            cleanMessage = json.error || match[1];
          } catch {
            cleanMessage = match[1];
          }
        } else {
          cleanMessage = error.message;
        }
      }
      setMessage(cleanMessage);
    }
  };

  const handleClose = () => {
    setEmployeeCode('');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setStatus('idle');
    setMessage('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-[440px] rounded-2xl p-6 shadow-2xl overflow-hidden">
        {status === 'success' ? (
          <div className="py-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-slate-900 text-center">
                Password Updated!
              </DialogTitle>
              <DialogDescription className="text-slate-500 text-center text-sm mt-1 px-4">
                {message}
              </DialogDescription>
            </DialogHeader>
            <div className="pt-4 flex justify-center">
              <Button 
                onClick={handleClose} 
                className="bg-[#5c59e8] hover:bg-[#4b48d6] text-white px-6 font-medium rounded-lg"
              >
                Go to Login
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-xl font-bold text-slate-900 leading-none">
                Create New Password
              </DialogTitle>
              <DialogDescription className="text-slate-500 text-sm font-normal">
                Enter your employee code and choose a new password.
              </DialogDescription>
            </DialogHeader>

            {status === 'error' && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-100 flex items-start gap-2.5 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
                <span>{message}</span>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="employee-code" className="text-sm font-semibold text-slate-700">
                  Employee Code
                </Label>
                <Input
                  id="employee-code"
                  placeholder="Enter employee code"
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#5c59e8] focus:ring-1 focus:ring-[#5c59e8] h-10 rounded-lg shadow-sm"
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-sm font-semibold text-slate-700">
                  New Password
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#5c59e8] focus:ring-1 focus:ring-[#5c59e8] h-10 pr-10 rounded-lg shadow-sm"
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-sm font-semibold text-slate-700">
                  Confirm Password
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#5c59e8] focus:ring-1 focus:ring-[#5c59e8] h-10 pr-10 rounded-lg shadow-sm"
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-3 gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isLoading}
                className="bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-800 rounded-lg font-medium shadow-sm h-10 shrink-0"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading}
                className="bg-[#5c59e8] hover:bg-[#4b48d6] text-white font-medium rounded-lg h-10 shadow-sm shrink-0"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Password'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
