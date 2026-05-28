import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { CheckCircle2, Circle, ArrowRight, ArrowLeft, Send, AlertTriangle, Clock, Calendar as CalendarIcon, ClipboardList, Target, Power, PowerOff, Lock, ArrowUp, ArrowDown, Search as PlannedTaskSearchIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, addDays } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function PlanForDayPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedTasks, setSelectedTasks] = useState<any[]>([]);
  const [commonReason, setCommonReason] = useState('');
  const [commonNewDueDate, setCommonNewDueDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [showUnselectedForm, setShowUnselectedForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'plan' | 'history'>('plan');
  const [historyDate, setHistoryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [assignedTaskSearch, setAssignedTaskSearch] = useState('');
  const [plannedTaskSearch, setPlannedTaskSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [adminViewType, setAdminViewType] = useState<'admin' | 'department' | 'my-tasks'>('admin');
  const [isCalendarPreviewOpen, setIsCalendarPreviewOpen] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [serverTimeOffset, setServerTimeOffset] = useState(0);

  const today = format(new Date(), 'yyyy-MM-dd');
  const isController = user?.role === 'admin' || user?.role === 'manager' || user?.employeeCode === 'E0046';

  const toMinutes = (time: string) => {
    if (!time) return 0;
    const [hours, minutes] = time.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  };

  const toTime = (minutes: number) => {
    const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  const durationForRange = (start: string, end: string) => Math.max(15, Math.min(8 * 60, toMinutes(end) - toMinutes(start)));

  const buildScheduledTasks = (tasks: any[]) => {
    const startOfDay = 9 * 60;
    const endOfDay = 17 * 60;
    let cursor = startOfDay;

    return tasks.map((task, index) => {
      const scheduleData = typeof task.scheduleData === 'object' && task.scheduleData ? task.scheduleData : {};
      const baseDuration = scheduleData.durationMinutes || task.durationMinutes || 30;
      const startTime = scheduleData.startTime || task.startTime || toTime(cursor);
      const startMin = toMinutes(startTime);
      const endTime = scheduleData.endTime || task.endTime || toTime(startMin + baseDuration);
      const durationMinutes = durationForRange(startTime, endTime);
      cursor = Math.max(startMin + durationMinutes, toMinutes(endTime));

      return {
        ...task,
        order: index + 1,
        startTime,
        endTime,
        durationMinutes,
        isAutoSelected: !!task.isAutoSelected || !!task.isLocked || task.source === 'PMS',
        scheduleData: {
          ...scheduleData,
          startTime,
          endTime,
          durationMinutes,
          order: index + 1,
          extensionReason: scheduleData.extensionReason || task.extensionReason || '',
        },
      };
    });
  };

  const persistPlanSchedule = (planTasks: any[]) => {
    if (!user?.id) return;

    localStorage.setItem(`plan_schedule_${user.id}_${today}`, JSON.stringify(planTasks));

    const pendingKey = `pendingTasks_${user.id}_${today}`;
    try {
      const storedDrafts = JSON.parse(localStorage.getItem(pendingKey) || '[]');
      if (Array.isArray(storedDrafts)) {
        const manualDrafts = storedDrafts.filter((task: any) => {
          return task?.source !== 'plan'
            && task?.isPlanTask !== true
            && task?.description !== 'Scheduled via Plan for Day'
            && task?.problemAndIssues !== 'Auto-filled from daily plan';
        });
        localStorage.setItem(pendingKey, JSON.stringify(manualDrafts));
      }
    } catch {
      localStorage.removeItem(pendingKey);
    }
  };

  const updateTaskSchedule = (taskId: string, field: 'startTime' | 'endTime' | 'extensionReason', value: string) => {
    setSelectedTasks(prev => buildScheduledTasks(prev.map(task => {
      if (task.id !== taskId) return task;
      const nextSchedule = { ...(task.scheduleData || {}), [field]: value };

      if (field === 'startTime' && nextSchedule.endTime) {
        nextSchedule.durationMinutes = durationForRange(nextSchedule.startTime, nextSchedule.endTime);
      }
      if (field === 'endTime' && nextSchedule.startTime) {
        nextSchedule.durationMinutes = durationForRange(nextSchedule.startTime, nextSchedule.endTime);
      }

      return {
        ...task,
        scheduleData: nextSchedule,
        ...(field === 'startTime' ? { startTime: value } : {}),
        ...(field === 'endTime' ? { endTime: value } : {}),
      };
    })));
  };

  const extendTask = (taskId: string) => {
    const target = selectedTasks.find(task => task.id === taskId);
    const reason = target?.scheduleData?.extensionReason || '';

    if (!reason.trim()) {
      toast({ title: 'Extension Reason Required', description: 'Add a short reason before extending the task.', variant: 'destructive' });
      return;
    }

    setSelectedTasks(prev => buildScheduledTasks(prev.map(task => {
      if (task.id !== taskId) return task;
      const updatedEnd = toMinutes(task.endTime) + 30;
      const nextSchedule = {
        ...(task.scheduleData || {}),
        endTime: toTime(updatedEnd),
        durationMinutes: durationForRange(task.startTime, toTime(updatedEnd)),
        extensionReason: reason,
      };

      return {
        ...task,
        endTime: nextSchedule.endTime,
        durationMinutes: nextSchedule.durationMinutes,
        scheduleData: nextSchedule,
      };
    })));

    toast({ title: 'Task Extended', description: `Task updated by 30 minutes. ${reason}` });
  };

  const reorderTask = (taskId: string, direction: 'up' | 'down') => {
    setSelectedTasks(prev => {
      const index = prev.findIndex(task => task.id === taskId);
      if (index < 0) return prev;

      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= prev.length) return prev;

      const next = [...prev];
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return buildScheduledTasks(next);
    });
  };

  const { data: windowData } = useQuery({
    queryKey: ['/api/plan-window'],
    queryFn: async () => {
      const res = await fetch('/api/plan-window');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: planStatus, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['/api/daily-plans/today', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const res = await fetch(`/api/daily-plans/today/${user?.id}`);
      if (!res.ok) return { submitted: false };
      return res.json();
    },
  });

  const { data: historyData, isLoading: isLoadingHistory } = useQuery({
    queryKey: ['/api/daily-plans', historyDate, user?.id],
    enabled: !!user?.id && !!historyDate,
    queryFn: async () => {
      const res = await fetch(`/api/daily-plans/${historyDate}/${user?.id}`);
      if (!res.ok) return { submitted: false };
      return res.json();
    },
  });

  const { data: availableTasks = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: ['/api/available-tasks', user?.id, adminViewType],
    enabled: !!user?.id,
    queryFn: async () => {
      const res = await fetch(`/api/available-tasks?employeeId=${user?.id}&viewType=${adminViewType}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const isWindowOpen = !!windowData?.planWindowOpen;
  const isPastCutoff = !!windowData?.isPastCutoff;
  const isOverrideToday = !!windowData?.isOverrideToday;
  const isAlreadySubmittedAndBlocked = planStatus?.submitted;
  const isWindowClosedNotSubmitted = !isWindowOpen && !planStatus?.submitted;

  useEffect(() => {
    if (windowData?.serverTime) {
      const serverDate = new Date(windowData.serverTime);
      const localDate = new Date();
      setServerTimeOffset(serverDate.getTime() - localDate.getTime());
    }
  }, [windowData?.serverTime]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === 'plan') {
      setShowUnselectedForm(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setShowUnselectedForm(false);
    setAssignedTaskSearch('');
    setPlannedTaskSearch('');
    setProjectSearch('');
  }, []);

  useEffect(() => {
    if (availableTasks.length === 0) return;

    if (planStatus?.submitted && planStatus.tasks && selectedTasks.length === 0) {
      const existingTasks = planStatus.tasks.map((task: any) => ({
        id: task.taskId,
        task_name: task.taskName,
        projectName: task.projectName,
        projectDescription: task.projectName,
        source: task.source || 'Manual',
        isLocked: !!task.isLocked || task.source === 'PMS',
        scheduleData: typeof task.scheduleData === 'string' ? JSON.parse(task.scheduleData) : (task.scheduleData || {}),
      }));
      setSelectedTasks(buildScheduledTasks(existingTasks));
      return;
    }

    if (!planStatus?.submitted && selectedTasks.length === 0) {
      const autoTasks = availableTasks.filter((task: any) => task.isAutoSelected);
      const breaks = [
        { id: 'break-morning', task_name: 'Morning Break', projectName: 'Break', isBreak: true, durationMinutes: 15 },
        { id: 'break-lunch', task_name: 'Lunch', projectName: 'Break', isBreak: true, durationMinutes: 30 },
        { id: 'break-evening', task_name: 'Evening Break', projectName: 'Break', isBreak: true, durationMinutes: 15 }
      ];
      if (autoTasks.length > 0 || breaks.length > 0) {
        setSelectedTasks(buildScheduledTasks([...breaks, ...autoTasks]));
      }
    }
  }, [availableTasks, planStatus, selectedTasks.length]);

  const toggleWindowMutation = useMutation({
    mutationFn: async (open: boolean) => {
      const res = await apiRequest('PATCH', '/api/plan-window', { employeeId: user?.id, open });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['/api/plan-window'], data);
      toast({
        title: data.planWindowOpen ? '🟢 Plan Window Opened' : '🔴 Plan Window Closed',
        description: data.planWindowOpen ? 'Employees can submit plans.' : 'Submission restricted.',
      });
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/daily-plans/reminder', { employeeId: user?.id });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: '✅ Alert Emails Sent', description: `Sent ${data.count} alerts.` });
    },
  });

  const sendEODReportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/check-missing-submissions', { actorId: user?.id });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: '📊 EOD Report Sent', description: 'Report sent to admins.' });
    },
  });

  const submitPlanMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest('POST', '/api/daily-plans', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-plans/today', user?.id] });
      toast({ title: 'Success', description: 'Your Plan for the Day has been submitted!' });
      setLocation('/tracker');
    },
    onError: (err: any) => {
      toast({ title: 'Submission Failed', description: err.message || 'Failed to submit plan.', variant: 'destructive' });
    },
  });

  const filteredAvailableTasks = availableTasks.filter((task: any) => {
    const matchesSearch = task.task_name.toLowerCase().includes(assignedTaskSearch.toLowerCase()) ||
                          task.projectName.toLowerCase().includes(assignedTaskSearch.toLowerCase());
    const matchesProject = projectSearch === '' || task.projectName === projectSearch;
    return matchesSearch && matchesProject && !task.isAutoSelected;
  });

  const uniqueProjects = Array.from(new Set(availableTasks.map((t: any) => t.projectName))).filter(Boolean).sort();

  const filteredSelectedTasks = selectedTasks.filter((task: any) =>
    task.task_name.toLowerCase().includes(plannedTaskSearch.toLowerCase()) ||
    task.projectName.toLowerCase().includes(plannedTaskSearch.toLowerCase())
  );

  const totalWorkingMinutes = selectedTasks.reduce((sum, task) => {
    return sum + (task.scheduleData?.durationMinutes || task.durationMinutes || 30);
  }, 0);
  const isValidPlan = totalWorkingMinutes >= 540;

  if (isLoadingPlan || isLoadingTasks) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-slate-950 text-white gap-4">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-slate-400 font-medium">Checking your schedule...</p>
      </div>
    );
  }

  const toggleTask = (task: any) => {
    if (task.isLocked) {
      toast({
        title: 'Task Locked',
        description: 'This is a PMS scheduled task and cannot be removed.',
      });
      return;
    }

    setSelectedTasks(prev => {
      const exists = prev.find(current => current.id === task.id);
      if (exists) {
        return buildScheduledTasks(prev.filter(current => current.id !== task.id));
      }
      return buildScheduledTasks([...prev, task]);
    });
  };

  const handleNext = () => {
    if (selectedTasks.length === 0) {
      toast({ title: 'Selection Required', description: 'Please select at least one task for your plan.', variant: 'destructive' });
      return;
    }

    const normalized = buildScheduledTasks(selectedTasks);
    setSelectedTasks(normalized);
    const unselected = availableTasks.filter((task: any) => !normalized.find((selected: any) => selected.id === task.id));
    if (unselected.length > 0) {
      setShowUnselectedForm(true);
      setCommonReason('');
      setCommonNewDueDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    } else {
      submitPlan();
    }
  };

  const submitPlan = () => {
    if (!isWindowOpen) {
      toast({ title: 'Submission Blocked', description: 'The plan window is closed.', variant: 'destructive' });
      return;
    }

    const normalized = buildScheduledTasks(selectedTasks);
    setSelectedTasks(normalized);

    const unselected = availableTasks.filter((task: any) => !normalized.find((selected: any) => selected.id === task.id))
      .map((task: any) => ({
        taskId: task.id,
        taskName: task.task_name,
        reason: commonReason,
        newDueDate: commonNewDueDate,
        start_date: task.start_date,
        end_date: task.end_date,
        progress: task.progress,
        isOverdue: task.isOverdue,
      }));

    if (showUnselectedForm && (!commonReason || !commonNewDueDate)) {
      toast({ title: 'Missing Information', description: 'Please provide a reason and new due date.', variant: 'destructive' });
      return;
    }

    persistPlanSchedule(normalized);

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }

    submitPlanMutation.mutate({
      employeeId: user?.id,
      date: today,
      selectedTasks: normalized,
      unselectedTasks: unselected,
    });
  };

  const getMinutesUntilCutoff = () => {
    const serverNow = new Date(currentTime.getTime() + serverTimeOffset);
    const utcTime = serverNow.getTime() + (serverNow.getTimezoneOffset() * 60000);
    const istNow = new Date(utcTime + (5.5 * 60 * 60 * 1000));
    const istCutoff = new Date(istNow);
    istCutoff.setUTCHours(12, 30, 0, 0);
    const diff = istCutoff.getTime() - istNow.getTime();
    return Math.floor(diff / 60000);
  };

  const minutesUntilCutoff = getMinutesUntilCutoff();
  const isNearCutoff = minutesUntilCutoff > 0 && minutesUntilCutoff <= 30;

  return (
    <div className="min-h-screen bg-[#020617] text-white p-4 md:p-8">
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between mb-12 gap-6">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-blue-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/20">
            <ClipboardList className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>PLAN FOR TODAY</h1>
            <p className="text-slate-400 font-bold uppercase text-xs tracking-widest mt-1 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-blue-500" /> {format(new Date(), 'EEEE, MMMM do')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-slate-900/50 p-2 rounded-2xl border border-slate-800">
          <Button variant="ghost" onClick={() => setActiveTab('plan')} className={`rounded-xl font-black text-xs px-6 py-5 ${activeTab === 'plan' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>DAILY PLAN</Button>
          <Button variant="ghost" onClick={() => setActiveTab('history')} className={`rounded-xl font-black text-xs px-6 py-5 ${activeTab === 'history' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>PLAN HISTORY</Button>

          {isController && (
            <div className="flex gap-2 ml-4 pl-4 border-l border-slate-800">
              <Button onClick={() => sendReminderMutation.mutate()} size="sm" variant="outline" className="rounded-xl border-amber-500/20 text-amber-500 hover:bg-amber-500/10">Remind All</Button>
              <Button onClick={() => sendEODReportMutation.mutate()} size="sm" variant="outline" className="rounded-xl border-green-500/20 text-green-500 hover:bg-green-500/10">EOD Report</Button>
            </div>
          )}

          {isController && (
            <Button onClick={() => toggleWindowMutation.mutate(!isWindowOpen)} size="sm" className={`rounded-xl font-black text-xs px-4 py-5 ${isWindowOpen ? 'bg-red-600/80' : 'bg-green-600'}`}>
              {isWindowOpen ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </header>

      {activeTab === 'history' ? (
        <HistorySection historyDate={historyDate} setHistoryDate={setHistoryDate} isLoadingHistory={isLoadingHistory} historyData={historyData} today={today} />
      ) : isAlreadySubmittedAndBlocked ? (
        <div className="flex flex-col h-[calc(100vh-250px)] items-center justify-center p-8 text-center">
          <div className="bg-slate-900/50 p-12 rounded-3xl border border-blue-500/20 max-w-lg w-full">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-8" />
            <h1 className="text-3xl font-extrabold mb-4">Today's Plan Ready!</h1>
            <p className="text-slate-400 mb-8">You've already locked in your tasks for today.</p>
            <div className="flex gap-4 justify-center">
              <Button onClick={() => setLocation('/tracker')} className="px-8 bg-blue-600">Go to Tracker</Button>
              <Button onClick={() => setActiveTab('history')} variant="outline" className="px-8">View Plan</Button>
            </div>
          </div>
        </div>
      ) : isWindowClosedNotSubmitted ? (
        <div className="flex flex-col h-[calc(100vh-250px)] items-center justify-center p-8 text-center">
          <div className="bg-slate-900/50 p-12 rounded-3xl border border-red-500/20 max-w-lg w-full">
            <PowerOff className="w-12 h-12 text-red-500 mx-auto mb-8" />
            <h1 className="text-3xl font-extrabold mb-4">Plan Window Closed</h1>
            <p className="text-slate-400 mb-8">{isOverrideToday ? 'Currently closed by administrator.' : (isPastCutoff ? 'Closed (12:30 PM cutoff)' : 'Currently closed by administrator.')}</p>
            <Button onClick={() => setLocation('/tracker')} className="px-8 bg-slate-700">Go to Tracker</Button>
          </div>
        </div>
      ) : !showUnselectedForm ? (
        <div className="space-y-6">
          {isNearCutoff && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-4 text-amber-400">
              <Clock className="w-6 h-6 animate-pulse" />
              <div>
                <p className="font-black text-sm uppercase">Plan Window Closing Soon!</p>
                <p className="text-xs opacity-80">{minutesUntilCutoff} minutes remaining.</p>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-250px)] min-h-[500px]">
            <Card className="bg-slate-900/60 border-slate-800 flex flex-col h-full overflow-hidden shadow-xl">
              <CardHeader className="border-b border-slate-800/50 p-4 space-y-4">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                  <CardTitle className="text-xl flex items-center gap-3 text-slate-200">
                    <Target className="w-5 h-5 text-slate-400" /> Available Tasks
                  </CardTitle>
                  {isController && (
                    <div className="flex gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 w-full xl:w-auto">
                      <Button variant="ghost" size="sm" onClick={() => setAdminViewType('admin')} className={`flex-1 xl:flex-none h-8 text-[10px] uppercase font-bold rounded-lg ${adminViewType === 'admin' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>All Tasks</Button>
                      <Button variant="ghost" size="sm" onClick={() => setAdminViewType('department')} className={`flex-1 xl:flex-none h-8 text-[10px] uppercase font-bold rounded-lg ${adminViewType === 'department' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Department</Button>
                      <Button variant="ghost" size="sm" onClick={() => setAdminViewType('my-tasks')} className={`flex-1 xl:flex-none h-8 text-[10px] uppercase font-bold rounded-lg ${adminViewType === 'my-tasks' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>My Tasks</Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <PlannedTaskSearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input placeholder="Search tasks..." value={assignedTaskSearch} onChange={(e) => setAssignedTaskSearch(e.target.value)} className="bg-slate-950/50 border-slate-800 pl-10 h-10" />
                  </div>
                  <div className="relative flex-1">
                    <select 
                      value={projectSearch} 
                      onChange={(e) => setProjectSearch(e.target.value)}
                      className="w-full h-10 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-200 outline-none cursor-pointer focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' }}
                    >
                      <option value="" style={{ background: '#0f172a', color: '#e2e8f0' }}>All Projects</option>
                      {uniqueProjects.map((p: any) => (
                        <option key={p as string} value={p as string} style={{ background: '#0f172a', color: '#e2e8f0', padding: '8px' }}>{p as string}</option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                      <ArrowDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                  {filteredAvailableTasks.length === 0 && !isLoadingTasks && (
                    <div className="py-20 text-center space-y-4">
                      <PlannedTaskSearchIcon className="w-12 h-12 text-slate-800 mx-auto" />
                      <p className="text-slate-500 font-medium">No manual tasks available.</p>
                    </div>
                  )}

                  {filteredAvailableTasks.map((task: any) => {
                    const isSelected = selectedTasks.find(current => current.id === task.id);
                    return (
                      <motion.div key={task.id} className={`p-5 rounded-2xl border cursor-pointer flex items-center gap-4 ${isSelected ? 'bg-blue-600/20 border-blue-500/50' : 'bg-slate-800/40 border-slate-700/50'}`} onClick={() => toggleTask(task)}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${isSelected ? 'bg-blue-500 border-blue-400 text-white' : 'bg-slate-900 border-slate-800 text-slate-700'}`}>
                          {isSelected ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-100">{task.task_name}</h3>
                          <p className="text-xs text-slate-500 font-bold uppercase">{task.projectName}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>

            <Card className="bg-slate-900/60 border-blue-500/10 flex flex-col h-full overflow-hidden shadow-xl">
              <CardHeader className="bg-blue-500/5 border-b border-blue-500/10 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl flex items-center gap-3 text-blue-400 font-black">YOUR PLAN</CardTitle>
                  <div className="bg-blue-500/20 px-3 py-1 rounded-full border border-blue-500/30">
                    <span className="text-xs font-black text-blue-400">{selectedTasks.length} SELECTED</span>
                  </div>
                </div>
                <div className="mt-3 relative">
                  <PlannedTaskSearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500/50" />
                  <Input placeholder="Search your plan..." value={plannedTaskSearch} onChange={(e) => setPlannedTaskSearch(e.target.value)} className="bg-slate-950/50 border-blue-500/20 pl-10" />
                </div>
              </CardHeader>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {selectedTasks.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-slate-500 text-sm">
                      Choose a task from the left to build your day schedule.
                    </div>
                  )}

                  {filteredSelectedTasks.map((task: any, index: number) => (
                    <div key={task.id} className="rounded-2xl border border-blue-500/20 bg-slate-950/60 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase text-blue-400 font-black">#{index + 1} • {task.isAutoSelected ? 'PMS Sync' : 'Manual'}</p>
                          <h4 className="font-black text-white mt-1">{task.task_name}</h4>
                          <p className="text-xs text-slate-400 uppercase">{task.projectName}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-800" onClick={() => reorderTask(task.id, 'up')} disabled={index === 0}><ArrowUp className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-800" onClick={() => reorderTask(task.id, 'down')} disabled={index === selectedTasks.length - 1}><ArrowDown className="w-4 h-4" /></Button>
                          {!task.isAutoSelected && (
                            <Button variant="ghost" size="sm" onClick={() => toggleTask(task)} className="text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl">Cancel</Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] uppercase text-slate-400 font-bold">Start</label>
                          <Input type="time" value={task.startTime} onChange={(e) => updateTaskSchedule(task.id, 'startTime', e.target.value)} className="bg-slate-950 border-slate-800" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-slate-400 font-bold">End</label>
                          <Input type="time" value={task.endTime} onChange={(e) => updateTaskSchedule(task.id, 'endTime', e.target.value)} className="bg-slate-950 border-slate-800" />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase text-slate-500 font-bold">Duration</p>
                          <p className="text-sm font-black text-blue-300">{Math.max(30, task.durationMinutes || 30)} minutes</p>
                        </div>
                        <Button type="button" size="sm" variant="outline" className="rounded-xl border-blue-500/30 text-blue-300" onClick={() => extendTask(task.id)}>Extend +30m</Button>
                      </div>

                      <div>
                        <label className="text-[10px] uppercase text-slate-400 font-bold">Extension Reason</label>
                        <Input placeholder="Optional reason for extension" value={task.scheduleData?.extensionReason || ''} onChange={(e) => updateTaskSchedule(task.id, 'extensionReason', e.target.value)} className="bg-slate-950 border-slate-800" />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-4 bg-slate-900/50 border-t border-slate-800 flex flex-col gap-4 shrink-0">
                <div className="space-y-2">
                  <div 
                    className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 p-1 -mx-1 rounded transition-colors"
                    onClick={() => setIsCalendarPreviewOpen(!isCalendarPreviewOpen)}
                  >
                    <h3 className="text-xs font-bold text-slate-400 uppercase">Calendar Preview</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 uppercase">Auto-syncs to tracker</span>
                      {isCalendarPreviewOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>
                  {isCalendarPreviewOpen && (
                    <div className="overflow-y-auto max-h-48 pr-2 space-y-2">
                      {selectedTasks.length === 0 ? (
                        <p className="text-sm text-slate-500">No tasks selected yet.</p>
                      ) : (
                        selectedTasks.map((task: any, index: number) => (
                          <div key={`${task.id}-${index}`} className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                                {task.scheduleData?.startTime || task.startTime || '9:00'} - {task.scheduleData?.endTime || task.endTime || '10:00'}
                              </span>
                              <span className="text-[10px] text-slate-400 uppercase ml-auto text-right">{task.projectName}</span>
                            </div>
                            <p className="text-sm font-medium text-slate-200 line-clamp-1">{task.task_name}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800/50">
                  <div className="flex items-center gap-2 text-xs text-amber-500 mb-3">
                    <AlertTriangle className="w-4 h-4" />
                    <span>TASKS MUST BE COMPLETED TODAY. (Total: {Math.floor(totalWorkingMinutes / 60)}h {totalWorkingMinutes % 60}m)</span>
                  </div>
                  <Button 
                    className={`w-full h-12 text-sm font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 ${isValidPlan ? 'bg-blue-600 hover:bg-blue-500 hover:scale-[1.02] text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                    disabled={!isValidPlan || !isWindowOpen}
                    onClick={handleNext}
                  >
                    {isValidPlan ? "LOCK IN MY PLAN" : `NEED 9 HOURS TOTAL (CURRENT: ${Math.floor(totalWorkingMinutes / 60)}h ${totalWorkingMinutes % 60}m)`}
                    {isValidPlan && <ArrowRight className="w-4 h-4 ml-2" />}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="max-w-4xl mx-auto">
          <Card className="bg-slate-900/80 border-amber-500/20 backdrop-blur-xl">
            <CardHeader className="bg-amber-500/5 border-b border-amber-500/10 p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-500/20 rounded-2xl flex items-center justify-center border border-amber-500/30"><AlertTriangle className="w-6 h-6 text-amber-500" /></div>
                <div><CardTitle className="text-2xl font-black text-white">Controlled Deviation Required</CardTitle><p className="text-amber-500/80 font-bold text-sm uppercase">Unselected tasks require justification</p></div>
              </div>
            </CardHeader>
            <CardContent className="p-8 space-y-8">
              <div className="p-8 rounded-3xl bg-slate-800/30 border border-slate-700/50 space-y-8">
                <div>
                  <Label className="text-slate-400 font-bold text-xs uppercase mb-4 block">Pending Tasks Being Postponed</Label>
                  <div className="flex flex-wrap gap-2">
                    {availableTasks.filter((task: any) => !selectedTasks.find((selected: any) => selected.id === task.id)).map((task: any) => (
                      <div key={task.id} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 text-sm font-bold flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500/50" /> {task.task_name}</div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <Label className="text-slate-400 font-bold text-xs uppercase">Reason for Deviation *</Label>
                    <Textarea placeholder="Justification..." value={commonReason} onChange={(e) => setCommonReason(e.target.value)} className="bg-slate-900 border-slate-700 text-white min-h-[120px]" />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-slate-400 font-bold text-xs uppercase">New Target Due Date *</Label>
                    <Input type="date" value={commonNewDueDate} min={today} onChange={(e) => setCommonNewDueDate(e.target.value)} className="bg-slate-950 border-slate-800 h-16 text-lg" />
                  </div>
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <Button variant="outline" onClick={() => setShowUnselectedForm(false)} className="px-8 py-6 rounded-2xl"><ArrowLeft className="w-5 h-5 mr-2" /> Back</Button>
                <Button onClick={submitPlan} className="flex-1 py-6 bg-gradient-to-r from-amber-600 to-orange-600 text-white font-black text-lg rounded-2xl" disabled={submitPlanMutation.isPending}>SUBMIT PLAN <Send className="w-6 h-6 ml-3" /></Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

function HistorySection({ historyDate, setHistoryDate, isLoadingHistory, historyData, today }: any) {
  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-black flex items-center gap-3"><CalendarIcon className="w-6 h-6 text-green-500" /> PLAN HISTORY</h2>
        <div className="bg-slate-900 p-2 rounded-2xl border border-slate-800 flex items-center">
          <CalendarIcon className="w-4 h-4 text-green-500 mx-3" />
          <Input type="date" value={historyDate} max={today} onChange={(e) => setHistoryDate(e.target.value)} className="bg-slate-950 border-none h-10 w-48 text-sm" />
        </div>
      </div>
      {isLoadingHistory ? <div className="py-20 text-center"><div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" /><p className="text-slate-500 font-bold uppercase text-xs">Loading...</p></div> :
        historyData?.submitted ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="bg-slate-900 border-slate-800 p-6"><h4 className="text-green-400 font-black mb-4 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> SELECTED</h4><div className="space-y-3">{historyData.tasks.map((t: any) => (<div key={t.id} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50"><h4 className="font-bold text-slate-100">{t.taskName}</h4><p className="text-xs text-slate-400 uppercase font-bold">{t.projectName}</p></div>))}</div></Card>
            <Card className="bg-slate-900 border-slate-800 p-6"><h4 className="text-amber-400 font-black mb-4 flex items-center gap-2"><Clock className="w-5 h-5" /> NOT SELECTED</h4><div className="space-y-3">{historyData.postponedTasks.length === 0 ? <p className="text-slate-500 italic">None</p> : historyData.postponedTasks.map((t: any, idx: number) => (<div key={idx} className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10"><h4 className="font-bold text-amber-100">{t.task_name}</h4><p className="text-sm text-slate-300 italic">{t.reason}</p><p className="text-[10px] text-amber-500/60 uppercase mt-2">Next: {t.new_due_date}</p></div>))}</div></Card>
          </div>
        ) : <div className="py-24 text-center bg-slate-900/50 rounded-3xl border border-slate-800 border-dashed"><p className="text-slate-500 font-bold text-lg">No plan submitted for this date.</p></div>}
    </div>
  );
}