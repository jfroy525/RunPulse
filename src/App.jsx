import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { Activity, Heart, TrendingDown, TrendingUp, Settings, ChevronDown, ChevronUp, Search, Calendar, MapPin, Clock, AlertCircle, Layout, User, LogOut, Check, X, Trophy, Flame, Zap, Footprints, Timer, Mountain, Settings2, ArrowUp, ArrowDown, Eye, EyeOff, BarChart3, LineChart as LineChartIcon } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Firebase Initialization ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const app = firebaseConfig ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Utility Functions ---
const formatPace = (speedMetersPerSecond) => {
  if (!speedMetersPerSecond || speedMetersPerSecond <= 0) return '0:00';
  const milesPerHour = speedMetersPerSecond * 2.23694;
  const minutesPerMile = 60 / milesPerHour;
  const minutes = Math.floor(minutesPerMile);
  const seconds = Math.floor((minutesPerMile - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const metersToMiles = (meters) => (meters * 0.000621371).toFixed(2);
const metersToFeet = (meters) => Math.round(meters * 3.28084);
const formatDuration = (seconds) => {
  if (!seconds) return '0m 0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
};

const parseLocalDateString = (dateStr) => new Date(dateStr + 'T12:00:00');

// --- Pulse+ Algorithm ---
const calculatePulsePlus = (avgHr, speedMps, distanceMi) => {
  if (!avgHr || !speedMps || !distanceMi) return { total: 0, hr: 0, pace: 0, dist: 0 };
  
  // HR (50%): 50 pts for <= 130bpm, 0 pts for >= 180bpm
  const hrScore = Math.max(0, Math.min(50, 50 * (180 - avgHr) / 50));
  
  // Pace (30%): 0 pts for ~13:24/mi (2.0 m/s), 30 pts for ~5:57/mi (4.5 m/s)
  const paceScore = Math.max(0, Math.min(30, 30 * (speedMps - 2.0) / 2.5));
  
  // Distance (20%): 0 pts for 1 mile, 20 pts for 15+ miles
  const distScore = Math.max(0, Math.min(20, 20 * (distanceMi - 1) / 14));
  
  return {
    total: Math.round(hrScore + paceScore + distScore),
    hr: Math.round(hrScore),
    pace: Math.round(paceScore),
    dist: Math.round(distScore)
  };
};

const DEFAULT_KPI_CONFIG = {
  totalDistance: true,
  totalRuns: true,
  avgHr: true,
  pulsePlus: true, // New KPI enabled by default
  hrTrend: false,
  maxHr: false,
  totalElevation: false
};

const DEFAULT_COLUMNS = [
  { key: 'date', label: 'Date', visible: true },
  { key: 'name', label: 'Name', visible: true },
  { key: 'pulsePlus', label: 'Pulse+', visible: true }, // New Column enabled by default
  { key: 'distance', label: 'Distance', visible: true },
  { key: 'pace', label: 'Pace', visible: true },
  { key: 'movingTime', label: 'Time', visible: false },
  { key: 'elevation', label: 'Elevation', visible: false },
  { key: 'avgHr', label: 'Avg HR', visible: true },
  { key: 'maxHr', label: 'Max HR', visible: false },
  { key: 'cadence', label: 'Cadence', visible: false },
  { key: 'calories', label: 'Calories', visible: false },
  { key: 'trainingLoad', label: 'Load', visible: false },
  { key: 'intensity', label: 'Intensity', visible: false },
  { key: 'rpe', label: 'RPE', visible: false }
];

const CHART_METRICS = {
  avgHr: { label: 'Average HR', color: '#f43f5e', unit: 'bpm', icon: Heart },
  rawSpeed: { label: 'Average Pace', color: '#10b981', unit: '/mi', icon: Clock }, // Added Pace Trend
  distance: { label: 'Distance', color: '#3b82f6', unit: 'mi', icon: MapPin },
  elevation: { label: 'Elevation Gain', color: '#f59e0b', unit: 'ft', icon: TrendingUp },
  cadence: { label: 'Average Cadence', color: '#14b8a6', unit: 'spm', icon: Footprints },
  trainingLoad: { label: 'Training Load', color: '#eab308', unit: '', icon: Zap }
};

export default function App() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const hasAutoSynced = useRef(false);

  // Navigation & Deep Dive State
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedRun, setSelectedRun] = useState(null);
  
  // Auth & DB State
  const [user, setUser] = useState(null);
  const [loginError, setLoginError] = useState('');
  
  // Configs
  const [kpiConfig, setKpiConfig] = useState(DEFAULT_KPI_CONFIG);
  const [tempKpiConfig, setTempKpiConfig] = useState(DEFAULT_KPI_CONFIG);
  const [showKpiModal, setShowKpiModal] = useState(false);

  // Column Configuration State
  const [columnConfig, setColumnConfig] = useState(DEFAULT_COLUMNS);
  const [tempColumnConfig, setTempColumnConfig] = useState(DEFAULT_COLUMNS);
  const [showColumnModal, setShowColumnModal] = useState(false);

  // Dashboard Time Filter & Chart State
  const [timeFrame, setTimeFrame] = useState('All Time');
  const [chartMetric, setChartMetric] = useState('avgHr');

  // Table State
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [filters, setFilters] = useState({});

  // Intervals.icu Auth State (HARDCODED for Vercel auto-sync bypass)
  const [showSettings, setShowSettings] = useState(false);
  const [athleteId, setAthleteId] = useState('i601186');
  const [apiKey, setApiKey] = useState('12qg950fiv6s1r0dqtq1203y1');
  const [apiError, setApiError] = useState('');

  // Fallback Auto-Sync for Live Environment
  useEffect(() => {
    if (!hasAutoSynced.current && athleteId && apiKey) {
      hasAutoSynced.current = true;
      fetchIntervalsData(athleteId, apiKey);
    }
  }, []);

  // --- KPI & Column Handlers ---
  const saveKpiPreferences = async () => {
    setKpiConfig(tempKpiConfig);
    setShowKpiModal(false);
  };

  const saveColumnPreferences = async () => {
    setColumnConfig(tempColumnConfig);
    setShowColumnModal(false);
  };

  const moveColumn = (index, direction) => {
    const newConfig = [...tempColumnConfig];
    if (direction === 'up' && index > 0) {
      [newConfig[index - 1], newConfig[index]] = [newConfig[index], newConfig[index - 1]];
    } else if (direction === 'down' && index < newConfig.length - 1) {
      [newConfig[index + 1], newConfig[index]] = [newConfig[index], newConfig[index + 1]];
    }
    setTempColumnConfig(newConfig);
  };

  const toggleColumnVisibility = (index) => {
    const newConfig = [...tempColumnConfig];
    newConfig[index].visible = !newConfig[index].visible;
    setTempColumnConfig(newConfig);
  };

  // --- Intervals.icu API Logic ---
  const fetchIntervalsData = async (aId, aKey) => {
    setLoading(true);
    setApiError('');
    
    const cleanId = aId.trim();
    const cleanKey = aKey.trim();
    
    try {
      const oldestDate = '2000-01-01'; 
      const newestDate = new Date().toISOString().split('T')[0]; 

      const response = await fetch(`https://intervals.icu/api/v1/athlete/${cleanId}/activities?oldest=${oldestDate}&newest=${newestDate}`, {
        method: 'GET',
        headers: { 
          'Authorization': `Basic ${btoa(`API_KEY:${cleanKey}`)}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`API Error ${response.status}: Unauthorized or Not Found.`);
      }
      
      const data = await response.json();
      
      const formattedRuns = data
        .filter(activity => activity.type && String(activity.type).toLowerCase().includes('run'))
        .map(activity => {
          const distanceMi = parseFloat(metersToMiles(activity.distance || 0));
          const avgHr = activity.average_heartrate ? Math.round(activity.average_heartrate) : null;
          const rawSpeed = activity.average_speed || 0;
          
          // Calculate Pulse+ 
          const pulsePlusData = calculatePulsePlus(avgHr, rawSpeed, distanceMi);

          return {
            id: activity.id || Math.random().toString(),
            date: (activity.start_date_local || activity.start_date || new Date().toISOString()).split('T')[0],
            name: activity.name || 'Unnamed Run',
            distance: distanceMi,
            pace: formatPace(rawSpeed),
            rawSpeed: rawSpeed, 
            movingTime: formatDuration(activity.moving_time || activity.elapsed_time || 0),
            avgHr: avgHr,
            maxHr: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
            elevation: metersToFeet(activity.total_elevation_gain || 0),
            cadence: activity.average_cadence ? Math.round(activity.average_cadence * 2) : null,
            calories: activity.calories ? Math.round(activity.calories) : null,
            trainingLoad: activity.icu_training_load || null,
            intensity: activity.icu_intensity ? Math.round(activity.icu_intensity) : null,
            rpe: activity.perceived_exertion || null,
            pulsePlus: pulsePlusData.total,
            pulsePlusBreakdown: pulsePlusData, // Keep breakdown for tooltips
            source: 'Intervals.icu',
            raw: activity 
          };
        });

      if (formattedRuns.length === 0) {
        setApiError(`Connected successfully, but 0 running activities were found.`);
      } else {
        setRuns(formattedRuns);
        setShowSettings(false);
      }
    } catch (err) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Data Processing & Filtering ---
  const timeFilteredRuns = useMemo(() => {
    if (timeFrame === 'All Time') return runs;
    const now = new Date();
    const cutoff = new Date();
    if (timeFrame === 'Last Week') cutoff.setDate(now.getDate() - 7);
    else if (timeFrame === 'Last Month') cutoff.setMonth(now.getMonth() - 1);
    else if (timeFrame === 'Last Year') cutoff.setFullYear(now.getFullYear() - 1);
    return runs.filter(run => parseLocalDateString(run.date) >= cutoff);
  }, [runs, timeFrame]);

  const stats = useMemo(() => {
    const activeRuns = timeFilteredRuns;
    const runsWithHr = activeRuns.filter(r => r.avgHr);
    const runsWithPulse = activeRuns.filter(r => r.pulsePlus > 0);
    
    if (runsWithHr.length === 0) {
      return { 
        avg: 0, trend: 0, pulseAvg: 0, pulseTrend: 0, totalRuns: activeRuns.length, 
        totalDistance: Math.round(activeRuns.reduce((s, r) => s + r.distance, 0)),
        maxHr: 0, totalElevation: Math.round(activeRuns.reduce((s, r) => s + r.elevation, 0))
      };
    }
    
    const midPoint = Math.floor(runsWithHr.length / 2);
    const recent = runsWithHr.slice(0, midPoint || 1); 
    const previous = runsWithHr.slice(midPoint, runsWithHr.length);
    
    // HR Stats
    const totalHr = runsWithHr.reduce((sum, run) => sum + run.avgHr, 0);
    const overallAvgHr = Math.round(totalHr / runsWithHr.length);
    const recentAvgHr = recent.length ? recent.reduce((s, r) => s + r.avgHr, 0) / recent.length : overallAvgHr;
    const previousAvgHr = previous.length ? previous.reduce((s, r) => s + r.avgHr, 0) / previous.length : overallAvgHr;

    // Pulse+ Stats
    const totalPulse = runsWithPulse.reduce((sum, run) => sum + run.pulsePlus, 0);
    const overallPulse = runsWithPulse.length ? Math.round(totalPulse / runsWithPulse.length) : 0;
    const recentPulse = runsWithPulse.slice(0, midPoint || 1);
    const previousPulse = runsWithPulse.slice(midPoint, runsWithPulse.length);
    const recentAvgPulse = recentPulse.length ? recentPulse.reduce((s, r) => s + r.pulsePlus, 0) / recentPulse.length : overallPulse;
    const prevAvgPulse = previousPulse.length ? previousPulse.reduce((s, r) => s + r.pulsePlus, 0) / previousPulse.length : overallPulse;

    return {
      avg: overallAvgHr,
      trend: Math.round(recentAvgHr - previousAvgHr),
      pulseAvg: overallPulse,
      pulseTrend: Math.round(recentAvgPulse - prevAvgPulse),
      totalRuns: activeRuns.length,
      totalDistance: Math.round(activeRuns.reduce((s, r) => s + r.distance, 0)),
      maxHr: Math.max(...activeRuns.map(r => r.maxHr).filter(Boolean)),
      totalElevation: Math.round(activeRuns.reduce((s, r) => s + r.elevation, 0))
    };
  }, [timeFilteredRuns]);

  // --- Dynamic Chart Helper Values ---
  const activeMetricConfig = CHART_METRICS[chartMetric];
  const MetricIcon = activeMetricConfig.icon;
  const chartData = useMemo(() => [...timeFilteredRuns].reverse(), [timeFilteredRuns]);
  const chartAvg = useMemo(() => {
    const validData = chartData.filter(r => typeof r[chartMetric] === 'number');
    if (validData.length === 0) return 0;
    const rawAvg = validData.reduce((sum, r) => sum + r[chartMetric], 0) / validData.length;
    return ['distance', 'rawSpeed'].includes(chartMetric) ? parseFloat(rawAvg.toFixed(2)) : Math.round(rawAvg);
  }, [chartData, chartMetric]);

  const chartYDomain = ['avgHr', 'maxHr', 'cadence', 'rawSpeed'].includes(chartMetric) ? ['dataMin - 5', 'dataMax + 5'] : [0, 'auto'];

  // Best Efforts
  const bestEfforts = useMemo(() => {
    const targets = [
      { name: '1 Mile', distanceMi: 1 }, { name: '5K', distanceMi: 3.10686 },
      { name: '10K', distanceMi: 6.21371 }, { name: 'Half Marathon', distanceMi: 13.1094 },
      { name: 'Marathon', distanceMi: 26.2188 }
    ];

    return targets.map(target => {
      const eligibleRuns = runs.filter(r => r.distance >= target.distanceMi && r.rawSpeed > 0);
      if (eligibleRuns.length === 0) return { ...target, time: '--', pace: '--', date: null, runName: null };
      const bestRun = eligibleRuns.reduce((fastest, current) => (current.rawSpeed > fastest.rawSpeed) ? current : fastest);
      const estimatedSeconds = (target.distanceMi * 1609.34) / bestRun.rawSpeed;
      return { ...target, time: formatDuration(estimatedSeconds), pace: bestRun.pace, date: bestRun.date, runName: bestRun.name };
    });
  }, [runs]);

  // --- Table Filtering & Sorting ---
  const visibleColumns = useMemo(() => columnConfig.filter(c => c.visible), [columnConfig]);

  const filteredRuns = useMemo(() => {
    return runs.filter(run => {
      return Object.keys(filters).every(key => {
        if (!filters[key]) return true;
        const runValue = String(run[key] || '').toLowerCase();
        return runValue.includes(filters[key].toLowerCase());
      });
    });
  }, [runs, filters]);

  const sortedRuns = useMemo(() => {
    let sortableRuns = [...filteredRuns];
    if (sortConfig.key !== null) {
      sortableRuns.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        if (['distance', 'avgHr', 'maxHr', 'elevation', 'cadence', 'calories', 'trainingLoad', 'intensity', 'rpe', 'pulsePlus'].includes(sortConfig.key)) {
          aValue = parseFloat(aValue) || 0;
          bValue = parseFloat(bValue) || 0;
        }
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableRuns;
  }, [filteredRuns, sortConfig]);

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const renderCellContent = (run, key) => {
    switch (key) {
      case 'date': return parseLocalDateString(run.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric'});
      case 'name': return <span className="truncate max-w-[200px] inline-block align-bottom" title={run.name}>{run.name}</span>;
      case 'distance': return <>{run.distance} <span className="text-xs text-gray-400">mi</span></>;
      case 'pace': return <>{run.pace} <span className="text-xs text-gray-400">/mi</span></>;
      case 'movingTime': return run.movingTime;
      case 'elevation': return <>{run.elevation} <span className="text-xs text-gray-400">ft</span></>;
      case 'avgHr': return (
        <span className={`px-2 py-1 rounded font-medium ${!run.avgHr ? 'text-gray-400' : run.avgHr > 165 ? 'bg-rose-100 text-rose-700' : run.avgHr > 145 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
          {run.avgHr || '--'} {run.avgHr && <span className="text-xs opacity-70">bpm</span>}
        </span>
      );
      case 'pulsePlus': return (
        <div className="relative group inline-block">
          <span className={`px-2 py-1 rounded font-bold cursor-help transition-colors ${!run.pulsePlus ? 'text-gray-400' : run.pulsePlus > 80 ? 'bg-green-100 text-green-800 hover:bg-green-200' : run.pulsePlus > 60 ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {run.pulsePlus || '--'}
          </span>
          {/* Tooltip Breakdown for Pulse+ in Table */}
          {run.pulsePlus > 0 && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              <p className="font-bold text-sm mb-1 text-center border-b border-gray-700 pb-1">Pulse+ Breakdown</p>
              <div className="flex justify-between py-0.5"><span className="text-gray-300">Heart Rate:</span> <span className="font-bold">{run.pulsePlusBreakdown.hr} / 50</span></div>
              <div className="flex justify-between py-0.5"><span className="text-gray-300">Pace:</span> <span className="font-bold">{run.pulsePlusBreakdown.pace} / 30</span></div>
              <div className="flex justify-between py-0.5"><span className="text-gray-300">Distance:</span> <span className="font-bold">{run.pulsePlusBreakdown.dist} / 20</span></div>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
            </div>
          )}
        </div>
      );
      case 'maxHr': return run.maxHr || '--';
      case 'cadence': return run.cadence ? <>{run.cadence} <span className="text-xs text-gray-400">spm</span></> : '--';
      case 'calories': return run.calories ? <>{run.calories.toLocaleString()} <span className="text-xs text-gray-400">kcal</span></> : '--';
      case 'trainingLoad': return run.trainingLoad || '--';
      case 'intensity': return run.intensity ? <>{run.intensity}<span className="text-xs text-gray-400">%</span></> : '--';
      case 'rpe': return run.rpe ? <>{run.rpe} <span className="text-xs text-gray-400">/10</span></> : '--';
      default: return run[key] || '--';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-12">
      <header className="bg-white border-b border-gray-200 px-6 pt-4 shadow-sm z-20 sticky top-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center space-x-3 w-full sm:w-auto">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-800">Runner's Data Hub</h1>
          </div>
          <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-end">
            <button onClick={() => setShowSettings(true)} className="flex items-center space-x-2 text-sm font-medium text-gray-600 hover:text-blue-600 bg-gray-100 hover:bg-blue-50 px-4 py-2 rounded-lg transition-colors">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Data Source</span>
            </button>
          </div>
        </div>

        <div className="flex space-x-6 border-b border-gray-200 mt-2 overflow-x-auto hide-scrollbar">
          <button onClick={() => setActiveTab('dashboard')} className={`pb-3 text-sm font-semibold transition-colors whitespace-nowrap ${activeTab === 'dashboard' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
            Dashboard & History
          </button>
          <button onClick={() => setActiveTab('best-efforts')} className={`pb-3 text-sm font-semibold transition-colors whitespace-nowrap ${activeTab === 'best-efforts' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
            Estimated Best Efforts
          </button>
          <button onClick={() => setActiveTab('analytics')} className={`pb-3 text-sm font-semibold transition-colors whitespace-nowrap ${activeTab === 'analytics' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
            Advanced Analytics
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-8">
        
        {/* --- VIEW: DASHBOARD & HISTORY --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            {/* KPI Controls & Time Filter */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
              <h2 className="text-2xl font-bold text-gray-800">Performance Overview</h2>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => { setTempKpiConfig(kpiConfig); setShowKpiModal(true); }} className="flex items-center text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg shadow-sm transition-colors">
                  <Layout className="w-4 h-4 mr-2" /> Customize KPIs
                </button>
                <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
                  <div className="pl-3 pr-2 py-1.5 text-gray-400"><Calendar className="w-4 h-4" /></div>
                  <select value={timeFrame} onChange={(e) => setTimeFrame(e.target.value)} className="bg-transparent text-sm font-medium text-gray-700 py-1.5 pr-8 pl-1 outline-none cursor-pointer hover:text-blue-600 transition-colors">
                    <option value="All Time">All Time</option>
                    <option value="Last Year">Last Year</option>
                    <option value="Last Month">Last Month</option>
                    <option value="Last Week">Last Week</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Dynamic KPI Dashboard */}
            <div className="flex flex-wrap gap-4">
              {kpiConfig.totalDistance && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-4">
                  <div className="bg-blue-50 p-3 rounded-full text-blue-600"><MapPin className="w-6 h-6" /></div>
                  <div><p className="text-sm font-medium text-gray-500">Total Distance</p><p className="text-2xl font-bold text-gray-900">{stats.totalDistance} <span className="text-sm font-normal text-gray-500">mi</span></p></div>
                </div>
              )}
              {kpiConfig.totalRuns && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-4">
                  <div className="bg-green-50 p-3 rounded-full text-green-600"><Clock className="w-6 h-6" /></div>
                  <div><p className="text-sm font-medium text-gray-500">Total Runs</p><p className="text-2xl font-bold text-gray-900">{stats.totalRuns}</p></div>
                </div>
              )}
              {kpiConfig.avgHr && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-4">
                  <div className="bg-rose-50 p-3 rounded-full text-rose-600"><Heart className="w-6 h-6" /></div>
                  <div><p className="text-sm font-medium text-gray-500">Average HR</p><p className="text-2xl font-bold text-gray-900">{stats.avg || '--'} <span className="text-sm font-normal text-gray-500">bpm</span></p></div>
                </div>
              )}
              {/* Pulse+ KPI */}
              {kpiConfig.pulsePlus && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-center">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-500">Avg Pulse+ Score</p>
                    {stats.pulseTrend === 0 ? (
                      <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Stable</span>
                    ) : stats.pulseTrend > 0 ? (
                      <span className="flex items-center text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full"><TrendingUp className="w-3 h-3 mr-1" /> +{Math.abs(stats.pulseTrend)} pts</span>
                    ) : (
                      <span className="flex items-center text-xs font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-full"><TrendingDown className="w-3 h-3 mr-1" /> {stats.pulseTrend} pts</span>
                    )}
                  </div>
                  <p className="text-2xl font-black text-indigo-600">{stats.pulseAvg || '--'} <span className="text-sm font-medium text-gray-400">/ 100</span></p>
                </div>
              )}
              {kpiConfig.hrTrend && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-center">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-500">HR Trend</p>
                    {stats.trend === 0 ? (
                      <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Stable</span>
                    ) : stats.trend < 0 ? (
                      <span className="flex items-center text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full"><TrendingDown className="w-3 h-3 mr-1" /> {Math.abs(stats.trend)} bpm</span>
                    ) : (
                      <span className="flex items-center text-xs font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-full"><TrendingUp className="w-3 h-3 mr-1" /> +{stats.trend} bpm</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">Within timeframe</p>
                </div>
              )}
              {kpiConfig.maxHr && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-4">
                  <div className="bg-purple-50 p-3 rounded-full text-purple-600"><Activity className="w-6 h-6" /></div>
                  <div><p className="text-sm font-medium text-gray-500">Highest Max HR</p><p className="text-2xl font-bold text-gray-900">{stats.maxHr || '--'} <span className="text-sm font-normal text-gray-500">bpm</span></p></div>
                </div>
              )}
            </div>

            {/* Dropdown Trends Chart */}
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <MetricIcon className="w-6 h-6 mr-3" style={{ color: activeMetricConfig.color }} />
                  <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value)} className="text-xl font-bold text-gray-800 bg-transparent outline-none cursor-pointer hover:text-gray-500 transition-colors border-none p-0 focus:ring-0">
                    {Object.entries(CHART_METRICS).map(([key, config]) => (
                      <option key={key} value={key}>{config.label} Trends</option>
                    ))}
                  </select>
                </div>
                <span className="text-xs font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded border border-gray-100">{timeFrame}</span>
              </div>
              <div className="h-72 w-full">
                {chartData.length < 2 ? (
                  <div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">Not enough data points in this timeframe to chart.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="date" tickFormatter={(val) => parseLocalDateString(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric'})} stroke="#9ca3af" fontSize={12} tickMargin={10} />
                      <YAxis 
                        domain={chartYDomain} 
                        stroke="#9ca3af" 
                        fontSize={12} 
                        tickFormatter={(val) => chartMetric === 'rawSpeed' ? formatPace(val) : Math.round(val)} 
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                        labelFormatter={(val) => parseLocalDateString(val).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric'})} 
                        formatter={(value) => [chartMetric === 'rawSpeed' ? formatPace(value) + ' /mi' : `${value} ${activeMetricConfig.unit}`, activeMetricConfig.label]} 
                      />
                      {chartAvg > 0 && <ReferenceLine y={chartAvg} stroke="#e5e7eb" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: `Avg: ${chartMetric === 'rawSpeed' ? formatPace(chartAvg) : chartAvg}`, fill: '#9ca3af', fontSize: 12 }} />}
                      <Line type="monotone" dataKey={chartMetric} stroke={activeMetricConfig.color} strokeWidth={3} dot={{ r: 3, fill: activeMetricConfig.color, strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} connectNulls={true} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Configurable Excel-Style Data Grid */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
              <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-800 flex items-center">
                  <Search className="w-5 h-5 mr-2 text-blue-500" />
                  Activity Database
                </h2>
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-medium text-gray-500 bg-white px-3 py-1 rounded-full shadow-sm border border-gray-100 hidden sm:inline-block">Showing {sortedRuns.length} runs</span>
                  <button onClick={() => { setTempColumnConfig(columnConfig); setShowColumnModal(true); }} className="flex items-center text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg shadow-sm transition-colors">
                    <Settings2 className="w-4 h-4 mr-2" /> Columns
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {visibleColumns.map((col) => (
                        <th key={col.key} onClick={() => requestSort(col.key)} className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none group whitespace-nowrap">
                          <div className="flex items-center">
                            {col.label}
                            {sortConfig.key === col.key ? (
                              sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4 ml-1 text-blue-500" /> : <ChevronDown className="w-4 h-4 ml-1 text-blue-500" />
                            ) : <span className="w-4 h-4 ml-1 inline-block text-transparent group-hover:text-gray-300"><ChevronDown className="w-4 h-4" /></span>}
                          </div>
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-white border-b border-gray-200 shadow-sm">
                      {visibleColumns.map((col) => (
                        <th key={`filter-${col.key}`} className="px-3 py-2 font-normal">
                          <input type="text" placeholder={`Filter...`} value={filters[col.key] || ''} onChange={(e) => setFilters(prev => ({ ...prev, [col.key]: e.target.value }))} className="w-full text-xs p-1.5 border border-gray-200 rounded bg-gray-50 text-gray-700 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400" />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan={visibleColumns.length} className="text-center py-12 text-gray-400">Loading data...</td></tr>
                    ) : sortedRuns.length === 0 ? (
                      <tr><td colSpan={visibleColumns.length} className="text-center py-12 text-gray-400">No runs match your filters.</td></tr>
                    ) : (
                      sortedRuns.map((run) => (
                        <tr key={run.id} onClick={() => setSelectedRun(run)} className="hover:bg-blue-50/50 transition-colors cursor-pointer group">
                          {visibleColumns.map((col) => (
                            <td key={`${run.id}-${col.key}`} className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 group-hover:text-blue-900 transition-colors">
                              {renderCellContent(run, col.key)}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- VIEW: BEST EFFORTS TAB --- */}
        {activeTab === 'best-efforts' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex justify-between items-center bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 flex items-center"><Trophy className="w-6 h-6 mr-2 text-yellow-500" /> Estimated Best Efforts</h2>
                <p className="text-sm text-gray-500 mt-1">Calculated based on your fastest average pace across all runs that meet or exceed the target distance.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {bestEfforts.map((effort) => (
                <div key={effort.name} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition-shadow">
                  <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-4 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">{effort.name}</h3>
                    <span className="text-blue-100 text-sm font-medium">{effort.distanceMi} mi</span>
                  </div>
                  <div className="p-6 flex-1 flex flex-col justify-center">
                    {effort.time === '--' ? (
                      <div className="text-center text-gray-400">
                        <Footprints className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No runs logged at this distance yet.</p>
                      </div>
                    ) : (
                      <>
                        <div className="text-center mb-4">
                          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Estimated Time</p>
                          <p className="text-4xl font-black text-gray-900">{effort.time}</p>
                          <p className="text-sm font-medium text-indigo-600 mt-1">@ {effort.pace} /mi</p>
                        </div>
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <p className="text-xs text-gray-500 mb-1">Derived from:</p>
                          <p className="text-sm font-medium text-gray-900 truncate" title={effort.runName}>{effort.runName}</p>
                          <p className="text-xs text-gray-500 flex items-center mt-1">
                            <Calendar className="w-3.5 h-3.5 mr-1" />
                            {parseLocalDateString(effort.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric'})}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- VIEW: ADVANCED ANALYTICS TAB --- */}
        {activeTab === 'analytics' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Multi-Metric Chart (Distance vs Pace vs HR) */}
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-800 flex items-center"><BarChart3 className="w-6 h-6 mr-2 text-indigo-500" /> Multi-Metric Overview</h2>
                <p className="text-sm text-gray-500 mt-1">A combined view of Distance (Bars), Average Pace (Green Line), and Average Heart Rate (Red Line).</p>
              </div>
              <div className="h-96 w-full">
                {chartData.length < 2 ? (
                  <div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">Not enough data to chart.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="date" tickFormatter={(val) => parseLocalDateString(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric'})} stroke="#9ca3af" fontSize={12} tickMargin={10} />
                      {/* Left Axis: Distance */}
                      <YAxis yAxisId="dist" orientation="left" stroke="#3b82f6" fontSize={12} />
                      {/* Right Axis: Heart Rate */}
                      <YAxis yAxisId="hr" orientation="right" domain={['dataMin - 10', 'dataMax + 10']} stroke="#f43f5e" fontSize={12} />
                      {/* Invisible Axis: Pace (scaled automatically so faster m/s goes UP) */}
                      <YAxis yAxisId="pace" orientation="right" domain={['dataMin', 'dataMax']} hide={true} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                        labelFormatter={(val) => parseLocalDateString(val).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric'})} 
                        formatter={(value, name) => {
                          if (name === 'rawSpeed') return [formatPace(value) + ' /mi', 'Pace'];
                          if (name === 'distance') return [value + ' mi', 'Distance'];
                          if (name === 'avgHr') return [value + ' bpm', 'Avg HR'];
                          return [value, name];
                        }}
                      />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} />
                      <Bar yAxisId="dist" dataKey="distance" name="Distance" fill="#3b82f6" opacity={0.6} radius={[4, 4, 0, 0]} />
                      <Line yAxisId="pace" type="monotone" dataKey="rawSpeed" name="Average Pace" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} connectNulls />
                      <Line yAxisId="hr" type="monotone" dataKey="avgHr" name="Average HR" stroke="#f43f5e" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Dedicated Pulse+ Trend Graph */}
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-800 flex items-center"><LineChartIcon className="w-6 h-6 mr-2 text-indigo-600" /> Pulse+ Score Progression</h2>
                <p className="text-sm text-gray-500 mt-1">Hover over any point to see exactly how your Heart Rate, Pace, and Distance contributed to the score.</p>
              </div>
              <div className="h-72 w-full">
                {chartData.length < 2 ? (
                  <div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">Not enough data to chart.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="date" tickFormatter={(val) => parseLocalDateString(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric'})} stroke="#9ca3af" fontSize={12} tickMargin={10} />
                      <YAxis domain={[0, 100]} stroke="#9ca3af" fontSize={12} />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            if (!data.pulsePlusBreakdown) return null;
                            const bd = data.pulsePlusBreakdown;
                            return (
                              <div className="bg-white p-4 rounded-xl shadow-xl border border-gray-100 min-w-[200px]">
                                <p className="font-bold text-gray-800 mb-1">{parseLocalDateString(label).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric'})}</p>
                                <p className="text-2xl font-black text-indigo-600 mb-3 border-b border-gray-100 pb-2">Score: {bd.total}</p>
                                <div className="space-y-1.5 text-sm">
                                  <div className="flex justify-between items-center"><span className="flex items-center text-gray-500"><Heart className="w-3.5 h-3.5 mr-1.5 text-rose-500"/> HR:</span> <span className="font-bold text-gray-900">{bd.hr} <span className="text-xs text-gray-400 font-normal">/ 50</span></span></div>
                                  <div className="flex justify-between items-center"><span className="flex items-center text-gray-500"><Clock className="w-3.5 h-3.5 mr-1.5 text-blue-500"/> Pace:</span> <span className="font-bold text-gray-900">{bd.pace} <span className="text-xs text-gray-400 font-normal">/ 30</span></span></div>
                                  <div className="flex justify-between items-center"><span className="flex items-center text-gray-500"><MapPin className="w-3.5 h-3.5 mr-1.5 text-green-500"/> Dist:</span> <span className="font-bold text-gray-900">{bd.dist} <span className="text-xs text-gray-400 font-normal">/ 20</span></span></div>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Line type="monotone" dataKey="pulsePlus" name="Pulse+ Score" stroke="#4f46e5" strokeWidth={4} dot={{ r: 4, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 7, strokeWidth: 0 }} connectNulls={true} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* --- Modals Below --- */}

      {/* 1. Deep Dive Run Modal */}
      {selectedRun && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-1 pr-8">{selectedRun.name}</h3>
                <p className="text-sm text-gray-500 flex items-center">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  {parseLocalDateString(selectedRun.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <button onClick={() => setSelectedRun(null)} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 hover:text-gray-700 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              
              {selectedRun.pulsePlus > 0 && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5 flex items-center justify-between">
                  <div>
                    <h4 className="text-lg font-bold text-indigo-900 flex items-center"><Activity className="w-5 h-5 mr-2 text-indigo-600" /> Pulse+ Efficiency Score</h4>
                    <p className="text-sm text-indigo-700 mt-1">A synthesized score combining HR (50%), Pace (30%), and Distance (20%).</p>
                  </div>
                  <div className="text-right">
                    <p className="text-4xl font-black text-indigo-600">{selectedRun.pulsePlus}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl">
                  <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1 flex items-center"><MapPin className="w-3.5 h-3.5 mr-1" /> Distance</p>
                  <p className="text-3xl font-black text-gray-900">{selectedRun.distance} <span className="text-sm font-medium text-gray-500">mi</span></p>
                </div>
                <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl">
                  <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1 flex items-center"><Clock className="w-3.5 h-3.5 mr-1" /> Pace</p>
                  <p className="text-3xl font-black text-gray-900">{selectedRun.pace} <span className="text-sm font-medium text-gray-500">/mi</span></p>
                </div>
                <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl">
                  <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-1 flex items-center"><Timer className="w-3.5 h-3.5 mr-1" /> Moving Time</p>
                  <p className="text-xl font-black text-gray-900 mt-1.5">{selectedRun.movingTime}</p>
                </div>
                <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-xl">
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-1 flex items-center"><Mountain className="w-3.5 h-3.5 mr-1" /> Elevation</p>
                  <p className="text-3xl font-black text-gray-900">{selectedRun.elevation} <span className="text-sm font-medium text-gray-500">ft</span></p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h4 className="text-lg font-bold text-gray-800 flex items-center border-b border-gray-100 pb-2"><Heart className="w-5 h-5 text-rose-500 mr-2" /> Heart Rate Data</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500 font-medium mb-1">Average HR</p><p className="text-2xl font-bold text-gray-900">{selectedRun.avgHr || '--'} <span className="text-sm text-gray-400 font-normal">bpm</span></p></div>
                    <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500 font-medium mb-1">Max HR</p><p className="text-2xl font-bold text-gray-900">{selectedRun.maxHr || '--'} <span className="text-sm text-gray-400 font-normal">bpm</span></p></div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="text-lg font-bold text-gray-800 flex items-center border-b border-gray-100 pb-2"><Activity className="w-5 h-5 text-blue-500 mr-2" /> Effort & Metrics</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500 font-medium mb-1 flex items-center"><Footprints className="w-4 h-4 mr-1.5 text-gray-400" /> Cadence</p><p className="text-xl font-bold text-gray-900">{selectedRun.cadence || '--'} <span className="text-xs text-gray-400 font-normal">spm</span></p></div>
                    <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500 font-medium mb-1 flex items-center"><Flame className="w-4 h-4 mr-1.5 text-orange-400" /> Calories</p><p className="text-xl font-bold text-gray-900">{selectedRun.calories?.toLocaleString() || '--'} <span className="text-xs text-gray-400 font-normal">kcal</span></p></div>
                    <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500 font-medium mb-1 flex items-center"><Zap className="w-4 h-4 mr-1.5 text-yellow-500" /> Training Load</p><p className="text-xl font-bold text-gray-900">{selectedRun.trainingLoad || '--'}</p></div>
                    <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500 font-medium mb-1 flex items-center"><TrendingUp className="w-4 h-4 mr-1.5 text-purple-500" /> Intensity</p><p className="text-xl font-bold text-gray-900">{selectedRun.intensity ? `${selectedRun.intensity}%` : '--'}</p></div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-500 flex justify-between items-center">
                <span><strong>Total Elapsed Time:</strong> {formatDuration(selectedRun.raw?.elapsed_time || 0)}</span>
                {selectedRun.rpe && (<span className="flex items-center"><strong>RPE:</strong> <span className="ml-2 bg-gray-200 text-gray-800 px-2 py-0.5 rounded-full text-xs font-bold">{selectedRun.rpe} / 10</span></span>)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Column Customization Modal */}
      {showColumnModal && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900 mb-1">Customize Table Columns</h3>
              <p className="text-sm text-gray-500">Toggle visibility and use the arrows to reorder.</p>
            </div>
            <div className="overflow-y-auto p-6 space-y-2 flex-1">
              {tempColumnConfig.map((col, index) => (
                <div key={col.key} className={`flex items-center justify-between p-3 rounded-lg border transition-all ${col.visible ? 'border-blue-200 bg-white shadow-sm' : 'border-gray-200 bg-gray-50 opacity-60'}`}>
                  <div className="flex items-center space-x-3 flex-1">
                    <button onClick={() => toggleColumnVisibility(index)} className="text-gray-400 hover:text-blue-600 transition-colors">
                      {col.visible ? <Eye className="w-5 h-5 text-blue-500" /> : <EyeOff className="w-5 h-5" />}
                    </button>
                    <span className={`text-sm font-medium ${col.visible ? 'text-gray-900' : 'text-gray-500'}`}>{col.label}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button onClick={() => moveColumn(index, 'up')} disabled={index === 0} className="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"><ArrowUp className="w-4 h-4" /></button>
                    <button onClick={() => moveColumn(index, 'down')} disabled={index === tempColumnConfig.length - 1} className="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"><ArrowDown className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex space-x-3">
              <button onClick={saveColumnPreferences} className="flex-1 bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors">Save Layout</button>
              <button onClick={() => setShowColumnModal(false)} className="flex-1 bg-gray-200 text-gray-700 font-medium py-2.5 rounded-lg hover:bg-gray-300 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* 3. KPI Customization Modal */}
      {showKpiModal && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Customize KPIs</h3>
            <p className="text-sm text-gray-500 mb-6">Select which metrics you want to see pinned to the top of your dashboard.</p>
            <div className="space-y-3 mb-6">
              {[
                { id: 'pulsePlus', label: 'Pulse+ Score', icon: Activity }, { id: 'totalDistance', label: 'Total Distance', icon: MapPin }, 
                { id: 'totalRuns', label: 'Total Runs', icon: Clock }, { id: 'avgHr', label: 'Average HR', icon: Heart }, 
                { id: 'hrTrend', label: 'HR Trend', icon: TrendingDown }, { id: 'maxHr', label: 'Highest Max HR', icon: Activity }, 
                { id: 'totalElevation', label: 'Total Elevation Gain', icon: TrendingUp },
              ].map((kpi) => {
                const Icon = kpi.icon;
                const isActive = tempKpiConfig[kpi.id];
                return (
                  <button key={kpi.id} onClick={() => setTempKpiConfig(prev => ({ ...prev, [kpi.id]: !prev[kpi.id] }))} className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
                    <div className="flex items-center space-x-3">
                      <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                      <span className={`text-sm font-medium ${isActive ? 'text-blue-900' : 'text-gray-600'}`}>{kpi.label}</span>
                    </div>
                    {isActive && <Check className="w-5 h-5 text-blue-600" />}
                  </button>
                )
              })}
            </div>
            <div className="flex space-x-3">
              <button onClick={saveKpiPreferences} className="flex-1 bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors">Save Layout</button>
              <button onClick={() => setShowKpiModal(false)} className="flex-1 bg-gray-100 text-gray-700 font-medium py-2.5 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Settings Modal (Intervals.icu) */}
      {showSettings && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Connect Data Source</h3>
            <p className="text-sm text-gray-500 mb-6">Connect to Intervals.icu to automatically import your Coros runs.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Athlete ID</label>
                <input type="text" placeholder="e.g. i12345" value={athleteId} onChange={(e) => setAthleteId(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                <input type="password" placeholder="Paste your API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              {apiError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-start"><AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" /><p>{apiError}</p></div>
              )}
              <div className="pt-4 flex space-x-3">
                <button onClick={() => fetchIntervalsData(athleteId, apiKey)} disabled={!athleteId || !apiKey} className="flex-1 bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Sync Data</button>
                <button onClick={() => setShowSettings(false)} className="flex-1 bg-gray-100 text-gray-700 font-medium py-2.5 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}