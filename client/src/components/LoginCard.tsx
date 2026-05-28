import { useState, useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Eye, EyeOff, User, Key, Hash, Loader2 } from 'lucide-react';
import logoImage from '@assets/WhatsApp_Image_2025-11-11_at_11.06.02_AM_1765464690595.jpeg';

interface LoginCardProps {
  onLogin: (employeeCode: string, name: string, password: string) => Promise<boolean>;
  onForgotPassword: () => void;
  isLoading?: boolean;
}

export default function LoginCard({ onLogin, onForgotPassword, isLoading = false }: LoginCardProps) {
  const [isSignup, setIsSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [loginData, setLoginData] = useState({
    employeeCode: '',
    name: '',
    password: ''
  });
  
  const [signupData, setSignupData] = useState({
    username: '',
    employeeCode: '',
    password: '',
    confirmPassword: ''
  });

  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    
    gsap.fromTo(cardRef.current,
      { opacity: 0, y: 30, scale: 0.95 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power2.out' }
    );
  }, []);

  const switchForm = () => {
    setError('');
    setSuccess('');
    
    gsap.to(cardRef.current, {
      opacity: 0,
      scale: 0.95,
      duration: 0.2,
      ease: 'power2.in',
      onComplete: () => {
        setIsSignup(!isSignup);
        gsap.to(cardRef.current, {
          opacity: 1,
          scale: 1,
          duration: 0.3,
          ease: 'power2.out'
        });
      }
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!loginData.employeeCode || !loginData.password) {
      setError('Please fill in all required fields');
      return;
    }
    
    const success = await onLogin(loginData.employeeCode, loginData.name, loginData.password);
    if (!success) {
      setError('Invalid employee code or password');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!signupData.username || !signupData.employeeCode || !signupData.password || !signupData.confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    
    if (signupData.password !== signupData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (signupData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    
    setSuccess('Account created successfully! Please login.');
    setTimeout(() => {
      setLoginData({ ...loginData, employeeCode: signupData.employeeCode, name: signupData.username });
      switchForm();
    }, 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent" />
      
      <div 
        ref={cardRef}
        className="relative w-full max-w-md z-10"
        data-testid="login-card-container"
      >
        {!isSignup ? (
          <Card className="w-full bg-slate-900/90 backdrop-blur-xl border-blue-500/20 shadow-2xl shadow-blue-500/10">
            <CardHeader className="text-center space-y-4">
              <div className="flex justify-center">
                <img 
                  src={logoImage} 
                  alt="Knockturn" 
                  className="h-12 object-contain"
                  data-testid="login-logo"
                />
              </div>
              <CardTitle className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
                Employee Login
              </CardTitle>
              <CardDescription className="text-blue-200/60">
                Enter your credentials to access the time tracker
              </CardDescription>
            </CardHeader>
            
            <form onSubmit={handleLogin}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm" data-testid="error-message">
                    {error}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="employeeCode" className="text-blue-100">Employee Code *</Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                    <Input
                      id="employeeCode"
                      placeholder="EMP001"
                      value={loginData.employeeCode}
                      onChange={(e) => setLoginData({ ...loginData, employeeCode: e.target.value.toUpperCase() })}
                      className="pl-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400"
                      data-testid="input-employee-code"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-blue-100">Password *</Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={loginData.password}
                      onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                      className="pl-10 pr-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400"
                      data-testid="input-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300"
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </button>
              </CardContent>
              
              <CardFooter className="flex flex-col gap-4">
                <Button 
                  type="submit" 
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold"
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    'Login'
                  )}
                </Button>
                
                <p className="text-sm text-blue-200/60 text-center">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={switchForm}
                    className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                    data-testid="link-signup"
                  >
                    Sign up
                  </button>
                </p>
              </CardFooter>
            </form>
          </Card>
        ) : (
          <Card className="w-full bg-slate-900/90 backdrop-blur-xl border-blue-500/20 shadow-2xl shadow-blue-500/10">
            <CardHeader className="text-center space-y-4">
              <div className="flex justify-center">
                <img 
                  src={logoImage} 
                  alt="Knockturn" 
                  className="h-12 object-contain"
                />
              </div>
              <CardTitle className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
                Create Account
              </CardTitle>
              <CardDescription className="text-blue-200/60">
                Register for a new employee account
              </CardDescription>
            </CardHeader>
            
            <form onSubmit={handleSignup}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}
                
                {success && (
                  <div className="p-3 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                    {success}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="signup-username" className="text-blue-100">Username *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                    <Input
                      id="signup-username"
                      placeholder="Your name"
                      value={signupData.username}
                      onChange={(e) => setSignupData({ ...signupData, username: e.target.value })}
                      className="pl-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400"
                      data-testid="input-signup-username"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="signup-code" className="text-blue-100">Employee Code *</Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                    <Input
                      id="signup-code"
                      placeholder="EMP001"
                      value={signupData.employeeCode}
                      onChange={(e) => setSignupData({ ...signupData, employeeCode: e.target.value.toUpperCase() })}
                      className="pl-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400"
                      data-testid="input-signup-code"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-blue-100">Password *</Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                    <Input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Create a password"
                      value={signupData.password}
                      onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                      className="pl-10 pr-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400"
                      data-testid="input-signup-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm" className="text-blue-100">Confirm Password *</Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                    <Input
                      id="signup-confirm"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Confirm your password"
                      value={signupData.confirmPassword}
                      onChange={(e) => setSignupData({ ...signupData, confirmPassword: e.target.value })}
                      className="pl-10 pr-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400"
                      data-testid="input-signup-confirm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </CardContent>
              
              <CardFooter className="flex flex-col gap-4">
                <Button 
                  type="submit" 
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold"
                  disabled={isLoading}
                  data-testid="button-signup"
                >
                  Create Account
                </Button>
                
                <p className="text-sm text-blue-200/60 text-center">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={switchForm}
                    className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                    data-testid="link-login"
                  >
                    Login
                  </button>
                </p>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
