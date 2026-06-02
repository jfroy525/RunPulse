import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, ComposedChart } from 'recharts';
import { Activity, Heart, TrendingDown, TrendingUp, Settings, ChevronDown, ChevronUp, Search, Calendar, MapPin, Clock, AlertCircle, Layout, User, LogOut, Check, X, Trophy, Flame, Zap, Footprints, Timer, Mountain, Settings2, ArrowUp, ArrowDown, Eye, EyeOff, BarChart3 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Firebase Initialization ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const app = firebaseConfig ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Utility Functions for Data Conversion ---
const formatPace = (speedMetersPerSecond) => {
  if (!speedMetersPerSecond) return '0:00';
  const milesPerHour = speedMetersPerSecond * 2.23694;
  const minutesPerMile = 60 / milesPerHour;
  const minutes = Math.floor(minutesPerMile);
  const seconds = Math.floor((minutesPerMile - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Converts speed (m/s) directly into total seconds per mile for accurate charting math
const speedToSecondsPerMile = (speedMetersPerSecond) => {
  if (!speedMetersPerSecond || speedMetersPerSecond <= 0) return 0;
  const milesPerHour = speedMetersPerSecond * 2.23694;
  return Math.round((60 / milesPerHour) * 60);
};

// Converts total seconds back to a M:SS string for chart labels
const formatSecondsToPaceString = (totalSeconds) => {
  if (!totalSeconds) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
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

const DEFAULT_KPI_CONFIG = {
  totalDistance: true,
  totalRuns: true,
  avgHr: true,
  hrTrend: true,
  maxHr: false,
  totalElevation: false
};

const DEFAULT_COLUMNS = [
  { key: 'date', label: 'Date', visible: true },
  { key: 'name', label: 'Name', visible: true },
  { key: 'distance', label: 'Distance', visible: true },
  { key: 'pace', label: 'Pace', visible: true },
  { key: 'movingTime', label: 'Time', visible: false },
  { key: 'elevation', label: 'Elevation', visible: false },
  { key: 'avgHr', label: 'Avg HR', visible: true },
  { key: 'maxHr', label: 'Max HR', visible: true },
  { key: 'cadence', label: 'Cadence', visible: false },
  { key: 'calories', label: 'Calories', visible: false },
  { key: 'trainingLoad', label: 'Load', visible: false },
  { key: 'intensity', label: 'Intensity', visible: false },
  { key: 'rpe', label: 'RPE', visible: false }
];

const CHART_METRICS = {
  avgHr: { label: 'Average HR', color: '#f43f5e', unit: 'bpm', icon: Heart },
  maxHr: { label: 'Max HR', color: '#a855f7', unit: 'bpm', icon: Activity },
  paceSeconds: { label: 'Average Pace', color: '#10b981', unit: '/mi', icon: Timer },
  distance: { label: 'Distance', color: '#3b82f6', unit: 'mi', icon: MapPin },
  elevation: { label: 'Elevation Gain', color: '#f59e0b', unit: 'ft', icon: TrendingUp },
  cadence: { label: 'Average Cadence', color: '#6366f1', unit: 'spm', icon: Footprints },
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

  // Intervals.icu Auth State
  const [showSettings, setShowSettings] = useState(false);
  const [athleteId, setAthleteId] = useState('i601186');
  const [apiKey, setApiKey] = useState('12qg950fiv6s1r0dqtq1203y1');
  const [apiError, setApiError] = useState('');

  // --- 1. Firebase Auth Initialization ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth init error", err);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // --- 2. Load User Preferences from Firestore ---
  useEffect(() => {
    if (!user || !db) return;

    // Load KPI Preferences
    const prefsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'preferences', 'kpi');
    const unsubscribeKpi = onSnapshot(prefsRef, (snap) => {
      if (snap.exists()) setKpiConfig(snap.data());
    }, (error) => console.error("Error fetching KPI prefs:", error));

    // Load Column Preferences
    const columnsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'preferences', 'columns');
    const unsubscribeColumns = onSnapshot(columnsRef, (snap) => {
      if (snap.exists()) {
        const savedCols = snap.data().columns;
        // Merge saved settings with default definitions in case new columns are added later
        const mergedCols = savedCols.map(savedCol => {
          const defaultCol = DEFAULT_COLUMNS.find(c => c.key === savedCol.key);
          return { ...defaultCol, ...savedCol };
        }).filter(c => c.key); 
        
        // Add any new default columns that weren't in saved settings
        const missingCols = DEFAULT_COLUMNS.filter(dc => !savedCols.find(sc => sc.key === dc.key));
        
        setColumnConfig([...mergedCols, ...missingCols]);
      }
    }, (error) => console.error("Error fetching Column prefs:", error));

    // Load Intervals API Credentials and Auto-Sync
    const intervalsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'preferences', 'intervals');
    const unsubscribeIntervals = onSnapshot(intervalsRef, (snap) => {
      let currentId = athleteId;
      let currentKey = apiKey;

      if (snap.exists()) {
        const data = snap.data();
        if (data.athleteId) {
          setAthleteId(data.athleteId);
          currentId = data.athleteId;
        }
        if (data.apiKey) {
          setApiKey(data.apiKey);
          currentKey = data.apiKey;
        }
      }
      
      // Auto-sync precisely once after we attempt to load saved credentials
      if (!hasAutoSynced.current) {
        hasAutoSynced.current = true;
        fetchIntervalsData(currentId, currentKey);
      }
    }, (error) => {
      console.error("Error fetching Intervals credentials:", error);
      if (!hasAutoSynced.current) {
        hasAutoSynced.current = true;
        fetchIntervalsData(athleteId, apiKey);
      }
    });

    return () => {
      unsubscribeKpi();
      unsubscribeColumns();
      unsubscribeIntervals();
    };
  }, [user]);

  // Fallback Auto-Sync if Firebase is completely disabled
  useEffect(() => {
    if (!auth && !hasAutoSynced.current) {
      hasAutoSynced.current = true;
      fetchIntervalsData(athleteId, apiKey);
    }
  }, []);

  // --- KPI & Column Handlers ---
  const saveKpiPreferences = async () => {
    setKpiConfig(tempKpiConfig);
    setShowKpiModal(false);
    if (user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'preferences', 'kpi'), tempKpiConfig);
      } catch (error) { console.error("Error saving KPI preferences:", error); }
    }
  };

  const saveColumnPreferences = async () => {
    setColumnConfig(tempColumnConfig);
    setShowColumnModal(false);
    if (user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'preferences', 'columns'), { columns: tempColumnConfig });
      } catch (error) { console.error("Error saving Column preferences:", error); }
    }
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
        let errorMsg = `API Error ${response.status}`;
        if (response.status === 401) errorMsg = "401 Unauthorized: Check your API Key.";
        if (response.status === 404) errorMsg = "404 Not Found: Check your Athlete ID.";
        throw new Error(errorMsg);
      }
      
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Received unexpected data format.");
      
      const foundTypes = new Set();
      
      const formattedRuns = data
        .filter(activity => {
          if (!activity.type) return false;
          foundTypes.add(activity.type);
          return String(activity.type).toLowerCase().includes('run'); 
        })
        .map(activity => ({
          id: activity.id || Math.random().toString(),
          date: (activity.start_date_local || activity.start_date || new Date().toISOString()).split('T')[0],
          name: activity.name || 'Unnamed Run',
          distance: parseFloat(metersToMiles(activity.distance || 0)),
          pace: formatPace(activity.average_speed || 0),
          paceSeconds: speedToSecondsPerMile(activity.average_speed || 0),
          rawSpeed: activity.average_speed || 0,
          movingTime: formatDuration(activity.moving_time || activity.elapsed_time || 0),
          avgHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
          maxHr: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
          elevation: metersToFeet(activity.total_elevation_gain || 0),
          cadence: activity.average_cadence ? Math.round(activity.average_cadence * 2) : null,
          calories: activity.calories ? Math.round(activity.calories) : null,
          trainingLoad: activity.icu_training_load || null,
          intensity: activity.icu_intensity ? Math.round(activity.icu_intensity) : null,
          rpe: activity.perceived_exertion || null,
          source: 'Intervals.icu',
          raw: activity 
        }));

      if (formattedRuns.length === 0) {
        setApiError(`Connected successfully, but 0 running activities were found. Activities found: ${Array.from(foundTypes).join(', ') || 'None'}`);
      } else {
        setRuns(formattedRuns);
        setShowSettings(false);
        if (user && db) {
          try {
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'preferences', 'intervals'), { athleteId: cleanId, apiKey: cleanKey }, { merge: true });
          } catch (err) { console.error("Failed to save credentials:", err); }
        }
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
    const maxHrList = activeRuns.map(r => r.maxHr).filter(Boolean);
    
    if (runsWithHr.length === 0) {
      return { 
        avg: 0, trend: 0, totalRuns: activeRuns.length, 
        totalDistance: Math.round(activeRuns.reduce((s, r) => s + r.distance, 0)),
        maxHr: 0, totalElevation: Math.round(activeRuns.reduce((s, r) => s + r.elevation, 0))
      };
    }
    
    const totalHr = runsWithHr.reduce((sum, run) => sum + run.avgHr, 0);
    const overallAvg = Math.round(totalHr / runsWithHr.length);
    const midPoint = Math.floor(runsWithHr.length / 2);
    const recent = runsWithHr.slice(0, midPoint || 1); 
    const previous = runsWithHr.slice(midPoint, runsWithHr.length);
    const recentAvg = recent.length ? recent.reduce((s, r) => s + r.avgHr, 0) / recent.length : overallAvg;
    const previousAvg = previous.length ? previous.reduce((s, r) => s + r.avgHr, 0) / previous.length : overallAvg;
    
    return {
      avg: overallAvg,
      trend: Math.round(recentAvg - previousAvg),
      totalRuns: activeRuns.length,
      totalDistance: Math.round(activeRuns.reduce((s, r) => s + r.distance, 0)),
      maxHr: maxHrList.length ? Math.max(...maxHrList) : 0,
      totalElevation: Math.round(activeRuns.reduce((s, r) => s + r.elevation, 0))
    };
  }, [timeFilteredRuns]);

  // --- Dynamic Chart Helper Values ---
  const activeMetricConfig = CHART_METRICS[chartMetric];
  const MetricIcon = activeMetricConfig.icon;
  const chartData = useMemo(() => [...timeFilteredRuns].reverse(), [timeFilteredRuns]);
  
  // Calculate dynamic average line for the selected metric
  const chartAvg = useMemo(() => {
    const validData = chartData.filter(r => typeof r[chartMetric] === 'number' && r[chartMetric] > 0);
    if (validData.length === 0) return 0;
    const rawAvg = validData.reduce((sum, r) => sum + r[chartMetric], 0) / validData.length;
    
    // Formatting handles specific rounding for distance, pace, vs whole numbers
    if (chartMetric === 'distance') return parseFloat(rawAvg.toFixed(2));
    if (chartMetric === 'paceSeconds') return Math.round(rawAvg);
    return Math.round(rawAvg);
  }, [chartData, chartMetric]);

  // Set chart scaling domains
  // Note: Pace is inverted (reversed) so that "faster" (lower seconds) visually appears higher on the graph.
  const getChartYDomain = () => {
    if (chartMetric === 'paceSeconds') return ['auto', 'auto']; // Handled explicitly by reversed prop on YAxis
    if (['avgHr', 'maxHr', 'cadence'].includes(chartMetric)) return ['dataMin - 5', 'dataMax + 5'];
    return [0, 'auto'];
  };

  // Tooltip Formatter to gracefully handle Pace strings vs Numeric values
  const tooltipFormatter = (value, name, props) => {
    if (chartMetric === 'paceSeconds') {
      return [`${formatSecondsToPaceString(value)} /mi`, activeMetricConfig.label];
    }
    return [`${value} ${activeMetricConfig.unit}`, activeMetricConfig.label];
  };

  // Tick Formatter for Y Axis
  const yAxisTickFormatter = (val) => {
    if (chartMetric === 'paceSeconds') return formatSecondsToPaceString(val);
    return Math.round(val);
  };

  // --- Best Efforts Calculation ---
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

      return {
        ...target,
        time: formatDuration(estimatedSeconds), pace: bestRun.pace,
        date: bestRun.date, runName: bestRun.name
      };
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
        
        // Ensure Pace is sorted numerically by seconds, not alphabetically by string
        if (sortConfig.key === 'pace') {
          aValue = a.paceSeconds || 0;
          bValue = b.paceSeconds || 0;
        } else if (['distance', 'avgHr', 'maxHr', 'elevation', 'cadence', 'calories', 'trainingLoad', 'intensity', 'rpe'].includes(sortConfig.key)) {
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
            <button 
              onClick={() => setShowSettings(true)}
              className="flex items-center space-x-2 text-sm font-medium text-gray-600 hover:text-blue-600 bg-gray-100 hover:bg-blue-50 px-4 py-2 rounded-lg transition-colors"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Data Source</span>
            </button>
          </div>
        </div>

        <div className="flex space-x-6 border-b border-gray-200 mt-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`pb-3 text-sm font-semibold transition-colors ${activeTab === 'dashboard' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Dashboard & History
          </button>
          <button 
            onClick={() => setActiveTab('analytics')}
            className={`pb-3 text-sm font-semibold transition-colors ${activeTab === 'analytics' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Advanced Analytics
          </button>
          <button 
            onClick={() => setActiveTab('best-efforts')}
            className={`pb-3 text-sm font-semibold transition-colors ${activeTab === 'best-efforts' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Estimated Best Efforts
          </button>
        </div>
      </header>

      {loginError && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-red-50 border border-red-200 p-4 rounded-lg shadow-sm flex items-start justify-between">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{loginError}</p>
            </div>
            <button onClick={() => setLoginError('')} className="text-red-400 hover:text-red-600 p-1"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-8">
        
        {/* --- VIEW: DASHBOARD & HISTORY --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            {/* KPI Controls & Time Filter */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
              <h2 className="text-2xl font-bold text-gray-800">Performance Overview</h2>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => { setTempKpiConfig(kpiConfig); setShowKpiModal(true); }}
                  className="flex items-center text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg shadow-sm transition-colors"
                >
                  <Layout className="w-4 h-4 mr-2" />
                  Customize KPIs
                </button>
                <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
                  <div className="pl-3 pr-2 py-1.5 text-gray-400"><Calendar className="w-4 h-4" /></div>
                  <select
                    value={timeFrame}
                    onChange={(e) => setTimeFrame(e.target.value)}
                    className="bg-transparent text-sm font-medium text-gray-700 py-1.5 pr-8 pl-1 outline-none cursor-pointer hover:text-blue-600 transition-colors"
                  >
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
                  <div>
                    <p className="text-sm font-medium text-gray-500">Total Distance</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalDistance} <span className="text-sm font-normal text-gray-500">mi</span></p>
                  </div>
                </div>
              )}
              {kpiConfig.totalRuns && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-4">
                  <div className="bg-green-50 p-3 rounded-full text-green-600"><Clock className="w-6 h-6" /></div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Total Runs</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalRuns}</p>
                  </div>
                </div>
              )}
              {kpiConfig.avgHr && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-4">
                  <div className="bg-rose-50 p-3 rounded-full text-rose-600"><Heart className="w-6 h-6" /></div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Average HR</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.avg || '--'} <span className="text-sm font-normal text-gray-500">bpm</span></p>
                  </div>
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
                  <div>
                    <p className="text-sm font-medium text-gray-500">Highest Max HR</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.maxHr || '--'} <span className="text-sm font-normal text-gray-500">bpm</span></p>
                  </div>
                </div>
              )}
              {kpiConfig.totalElevation && (
                <div className="flex-1 min-w-[200px] bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-4">
                  <div className="bg-amber-50 p-3 rounded-full text-amber-600"><TrendingUp className="w-6 h-6" /></div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Elevation Gain</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalElevation.toLocaleString()} <span className="text-sm font-normal text-gray-500">ft</span></p>
                  </div>
                </div>
              )}
            </div>

            {/* Dynamic Trends Chart */}
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <MetricIcon className="w-6 h-6 mr-3" style={{ color: activeMetricConfig.color }} />
                  <select
                    value={chartMetric}
                    onChange={(e) => setChartMetric(e.target.value)}
                    className="text-xl font-bold text-gray-800 bg-transparent outline-none cursor-pointer hover:text-gray-500 transition-colors border-none p-0 focus:ring-0"
                  >
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
                        domain={getChartYDomain()} 
                        stroke="#9ca3af" 
                        fontSize={12} 
                        tickFormatter={yAxisTickFormatter} 
                        reversed={chartMetric === 'paceSeconds'} // Reverse pace so faster (lower time) is visually higher
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                        labelFormatter={(val) => parseLocalDateString(val).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric'})} 
                        formatter={tooltipFormatter} 
                      />
                      {chartAvg > 0 && (
                        <ReferenceLine 
                          y={chartAvg} 
                          stroke="#e5e7eb" 
                          strokeDasharray="3 3" 
                          label={{ position: 'insideTopLeft', value: `Avg: ${chartMetric === 'paceSeconds' ? formatSecondsToPaceString(chartAvg) : chartAvg}`, fill: '#9ca3af', fontSize: 12 }} 
                        />
                      )}
                      <Line 
                        type="monotone" 
                        dataKey={chartMetric} 
                        stroke={activeMetricConfig.color} 
                        strokeWidth={3} 
                        dot={{ r: 3, fill: activeMetricConfig.color, strokeWidth: 0 }} 
                        activeDot={{ r: 6, strokeWidth: 0 }} 
                        name={activeMetricConfig.label} 
                        connectNulls={true} 
                      />
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
                  <span className="text-sm font-medium text-gray-500 bg-white px-3 py-1 rounded-full shadow-sm border border-gray-100 hidden sm:inline-block">
                    Showing {sortedRuns.length} runs
                  </span>
                  <button 
                    onClick={() => { setTempColumnConfig(columnConfig); setShowColumnModal(true); }}
                    className="flex items-center text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                  >
                    <Settings2 className="w-4 h-4 mr-2" />
                    Columns
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {visibleColumns.map((col) => (
                        <th 
                          key={col.key}
                          onClick={() => requestSort(col.key)}
                          className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none group whitespace-nowrap"
                        >
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
                          <input
                            type="text"
                            placeholder={`Filter...`}
                            value={filters[col.key] || ''}
                            onChange={(e) => setFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                            className="w-full text-xs p-1.5 border border-gray-200 rounded bg-gray-50 text-gray-700 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                          />
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
                        <tr 
                          key={run.id} 
                          onClick={() => setSelectedRun(run)}
                          className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                        >
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

        {/* --- VIEW: ADVANCED ANALYTICS (Multi-Metric Chart) --- */}
        {activeTab === 'analytics' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <div className="mb-6 border-b border-gray-100 pb-4">
                <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                  <BarChart3 className="w-6 h-6 mr-3 text-indigo-500" /> 
                  Distance vs. Pace vs. Heart Rate
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Visualize how your pace and heart rate respond to different running volumes. This chart maps your entire loaded history.
                </p>
              </div>

              <div className="h-[500px] w-full mt-4">
                {chartData.length < 2 ? (
                  <div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">Not enough data to map advanced correlations.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(val) => parseLocalDateString(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric'})} 
                        stroke="#9ca3af" 
                        fontSize={12} 
                        tickMargin={10} 
                      />
                      
                      {/* Left Y-Axis: Distance (Bars) */}
                      <YAxis 
                        yAxisId="distance" 
                        orientation="left" 
                        stroke="#3b82f6" 
                        fontSize={12} 
                        label={{ value: 'Distance (mi)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#3b82f6', fontSize: 12 } }}
                      />
                      
                      {/* Right Y-Axis 1: Heart Rate (Red Line) */}
                      <YAxis 
                        yAxisId="hr" 
                        orientation="right" 
                        stroke="#f43f5e" 
                        fontSize={12} 
                        domain={['dataMin - 10', 'dataMax + 10']}
                        label={{ value: 'Avg HR (bpm)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#f43f5e', fontSize: 12 } }}
                      />

                      {/* Right Y-Axis 2: Pace (Green Line - Hidden axis scale to avoid clutter, but maps the data) */}
                      <YAxis 
                        yAxisId="pace" 
                        orientation="right" 
                        hide={true} 
                        reversed={true} // Reverse so faster pace is higher
                        domain={['dataMin - 15', 'dataMax + 15']}
                      />

                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                        labelFormatter={(val) => parseLocalDateString(val).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric'})}
                        formatter={(value, name) => {
                          if (name === 'Average Pace') return [`${formatSecondsToPaceString(value)} /mi`, name];
                          if (name === 'Distance') return [`${value} mi`, name];
                          if (name === 'Average HR') return [`${value} bpm`, name];
                          return [value, name];
                        }}
                      />
                      <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '13px' }}/>
                      
                      {/* Data Elements */}
                      <Bar yAxisId="distance" dataKey="distance" name="Distance" fill="#eff6ff" stroke="#3b82f6" strokeWidth={1} radius={[4, 4, 0, 0]} barSize={20} />
                      <Line yAxisId="pace" type="monotone" dataKey="paceSeconds" name="Average Pace" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} connectNulls={true} />
                      <Line yAxisId="hr" type="monotone" dataKey="avgHr" name="Average HR" stroke="#f43f5e" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} connectNulls={true} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
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
                { id: 'totalDistance', label: 'Total Distance', icon: MapPin }, { id: 'totalRuns', label: 'Total Runs', icon: Clock },
                { id: 'avgHr', label: 'Average HR', icon: Heart }, { id: 'hrTrend', label: 'HR Trend', icon: TrendingDown },
                { id: 'maxHr', label: 'Highest Max HR', icon: Activity }, { id: 'totalElevation', label: 'Total Elevation Gain', icon: TrendingUp },
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