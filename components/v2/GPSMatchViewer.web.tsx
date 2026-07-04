import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { GoogleMap, useJsApiLoader, Polyline, Polygon, Marker, HeatmapLayerF } from '@react-google-maps/api';
import { Ionicons } from '@expo/vector-icons';
import { Card, SectionTitle, C, FONTS, S } from './ui';
import { useEnv } from '../../hooks/use-env';
import { Participant, GPSTrack } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { fetchParticipants } from '../../lib/services/participantService';
import { fetchGPSPlayTracks, saveGPSTrack, deleteGPSTrack } from '../../lib/services/gpsService';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";

const TRACK_COLORS = [
  '#38BDF8', // Light Blue (Sky)
  '#F43F5E', // Rose / Red
  '#17713A', // Emerald / Green
  '#EDAF00', // Amber / Orange
  '#8B5CF6', // Violet / Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#14B8A6', // Teal
  '#3B82F6', // Blue
  '#84CC16', // Lime
];

const getTrackColor = (index: number) => {
  return TRACK_COLORS[index % TRACK_COLORS.length];
};

interface GPSPoint {
  lat: number;
  lng: number;
  speed: number; // km/h
  sats: number;
  date: string;
  time: string;
}

interface DisplayTrack {
  id: string;
  player_name: string;
  participant_id?: string | null;
  points: GPSPoint[];
  color: string;
  visible: boolean;
  stats: {
    distanceKm: string;
    maxSpeed: string;
    avgSpeed: string;
    sprints: number;
    durationMin: number;
  };
}

// Formula de Haversine
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Offset conversion
const meterOffsetToLatLng = (centerLat: number, centerLng: number, dx: number, dy: number, angleDegrees: number) => {
  const angleRad = (angleDegrees * Math.PI) / 180;
  const rx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
  const ry = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);

  const lat = centerLat + ry / 111320;
  const lng = centerLng + rx / ((40075000 * Math.cos((centerLat * Math.PI) / 180)) / 360);
  return { lat, lng };
};

const timeToSeconds = (timeStr: string): number => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const hrs = parseInt(parts[0], 10) || 0;
  const mins = parseInt(parts[1], 10) || 0;
  const secs = parseInt(parts[2], 10) || 0;
  return hrs * 3600 + mins * 60 + secs;
};

const parseDateTimeToMs = (dateStr: string, timeStr: string) => {
  const dateParts = dateStr.split('-');
  const timeParts = timeStr.split(':');
  if (dateParts.length < 3 || timeParts.length < 3) return 0;
  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10) - 1;
  const day = parseInt(dateParts[2], 10);
  const hour = parseInt(timeParts[0], 10);
  const minute = parseInt(timeParts[1], 10);
  const second = parseInt(timeParts[2], 10);
  return new Date(year, month, day, hour, minute, second).getTime();
};

const computeStatsForPoints = (points: GPSPoint[]) => {
  if (points.length === 0) return { distanceKm: "0.00", maxSpeed: "0.0", avgSpeed: "0.0", sprints: 0, durationMin: 0 };

  let totalDist = 0;
  for (let i = 1; i < points.length; i++) {
    totalDist += haversineDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }

  const maxSpeed = Math.max(...points.map((p) => p.speed));

  const movingPoints = points.filter((p) => p.speed > 1.5);
  const avgSpeed =
    movingPoints.length > 0
      ? movingPoints.reduce((acc, p) => acc + p.speed, 0) / movingPoints.length
      : 0;

  const durationMin = Math.round(points.length / 60);

  let sprints = 0;
  let inSprint = false;
  points.forEach((p) => {
    if (p.speed >= 18.0) {
      if (!inSprint) {
        sprints++;
        inSprint = true;
      }
    } else if (p.speed < 14.0) {
      inSprint = false;
    }
  });

  return {
    distanceKm: (totalDist / 1000).toFixed(2),
    maxSpeed: maxSpeed.toFixed(1),
    avgSpeed: avgSpeed.toFixed(1),
    sprints,
    durationMin,
  };
};

export default function GPSMatchViewer({ matchId }: { matchId: string }) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    version: '3.64',
    libraries: ['places', 'visualization'] as any
  });

  const { fromTable } = useEnv();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [savedTracks, setSavedTracks] = useState<GPSTrack[]>([]);
  const [matchDetails, setMatchDetails] = useState<{ real_start_time: string | null; real_end_time: string | null } | null>(null);
  const [downsampleRate, setDownsampleRate] = useState(1);
  
  // Track IDs that are currently visible on the map
  const [visibleTrackIds, setVisibleTrackIds] = useState<Set<string>>(new Set());

  // Sorting state for metrics table
  const [sortField, setSortField] = useState<'player_name' | 'distance' | 'maxSpeed' | 'avgSpeed' | 'sprints' | 'duration' | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  // States for manual CSV upload
  const [selectedFileForUpload, setSelectedFileForUpload] = useState<Omit<GPSTrack, 'id'> | null>(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Map configuration & pitch alignment states
  const mapRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [userMapCenter, setUserMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [isControlsOpen, setIsControlsOpen] = useState(true);
  const [showChart, setShowChart] = useState(false);
  const [mapHeading, setMapHeading] = useState(0);
  const [showFieldMode, setShowFieldMode] = useState(false);
  const [showPitchOverlay, setShowPitchOverlay] = useState(false);
  const [pitchCenter, setPitchCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [pitchAngle, setPitchAngle] = useState(0);
  const [pitchWidth, setPitchWidth] = useState(95);
  const [pitchHeight, setPitchHeight] = useState(55);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(18);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Replay animation states
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playSpeed, setPlaySpeed] = useState(5);
  const timerRef = useRef<any>(null);

  // 1. Load data from Supabase
  const loadData = async () => {
    try {
      const [parts, tracks, mRes] = await Promise.all([
        fetchParticipants(matchId, fromTable),
        fetchGPSPlayTracks(matchId, fromTable),
        supabase.from(fromTable('matches')).select('real_start_time, real_end_time').eq('id', matchId).single()
      ]);
      setParticipants(parts);
      setSavedTracks(tracks);
      if (mRes?.data) {
        setMatchDetails(mRes.data);
      }

      // Auto-enable visibility for all saved tracks initially
      if (tracks.length > 0) {
        const initialVisible = new Set<string>();
        tracks.forEach(t => initialVisible.add(t.id));
        setVisibleTrackIds(initialVisible);
      }

      // Try to load pitch alignment
      let dbPitchCenter: { lat: number; lng: number } | null = null;
      let dbPitchAngle = 0;
      let dbPitchWidth = 95;
      let dbPitchHeight = 55;

      // A. Try loading from Supabase matches table
      try {
        const { data: pitchData, error: pitchErr } = await supabase
          .from(fromTable('matches'))
          .select('pitch_center_lat, pitch_center_lng, pitch_angle, pitch_width, pitch_height')
          .eq('id', matchId)
          .single();
        
        if (!pitchErr && pitchData) {
          if (pitchData.pitch_center_lat && pitchData.pitch_center_lng) {
            dbPitchCenter = { lat: pitchData.pitch_center_lat, lng: pitchData.pitch_center_lng };
          }
          if (typeof pitchData.pitch_angle === 'number') dbPitchAngle = pitchData.pitch_angle;
          if (typeof pitchData.pitch_width === 'number') dbPitchWidth = pitchData.pitch_width;
          if (typeof pitchData.pitch_height === 'number') dbPitchHeight = pitchData.pitch_height;
        }
      } catch (e) {
        console.warn('Pitch columns not available in DB, using local fallback:', e);
      }

      // B. Try loading from localStorage if not found in DB
      if (!dbPitchCenter) {
        try {
          const savedLocal = localStorage.getItem(`pitch_align_${matchId}`);
          if (savedLocal) {
            const parsed = JSON.parse(savedLocal);
            if (parsed.center) dbPitchCenter = parsed.center;
            if (typeof parsed.angle === 'number') dbPitchAngle = parsed.angle;
            if (typeof parsed.width === 'number') dbPitchWidth = parsed.width;
            if (typeof parsed.height === 'number') dbPitchHeight = parsed.height;
          }
        } catch (e) {
          console.error('Error loading from localStorage:', e);
        }
      }

      // C. Set values or fallback to average track coordinates
      if (dbPitchCenter) {
        setPitchCenter(dbPitchCenter);
        setPitchAngle(dbPitchAngle);
        setPitchWidth(dbPitchWidth);
        setPitchHeight(dbPitchHeight);
      } else if (tracks.length > 0 && tracks[0].points.length > 0) {
        const firstPts = tracks[0].points;
        const avgLat = firstPts.reduce((acc, p) => acc + p.lat, 0) / firstPts.length;
        const avgLng = firstPts.reduce((acc, p) => acc + p.lng, 0) / firstPts.length;
        setPitchCenter({ lat: avgLat, lng: avgLng });
      }

    } catch (err) {
      console.error('Error loading Supabase match data:', err);
    }
  };

  const savePitchAlignment = async (
    center: { lat: number; lng: number },
    angle: number,
    width: number,
    height: number
  ) => {
    // 1. Always save to localStorage
    try {
      localStorage.setItem(
        `pitch_align_${matchId}`,
        JSON.stringify({ center, angle, width, height })
      );
    } catch (e) {
      console.error('Error saving to localStorage:', e);
    }

    // 2. Try to save to Supabase matches table
    try {
      await supabase
        .from(fromTable('matches'))
        .update({
          pitch_center_lat: center.lat,
          pitch_center_lng: center.lng,
          pitch_angle: angle,
          pitch_width: width,
          pitch_height: height
        })
        .eq('id', matchId);
    } catch (e) {
      console.warn('Error saving pitch alignment to DB:', e);
    }
  };

  useEffect(() => {
    loadData();
  }, [matchId, fromTable]);

  // Automatically toggle Vista Campo (showFieldMode) based on Aligner overlay status
  useEffect(() => {
    if (showPitchOverlay) {
      setShowFieldMode(false);
    } else if (pitchCenter) {
      setShowFieldMode(true);
      // Save alignment parameters persistently
      savePitchAlignment(pitchCenter, pitchAngle, pitchWidth, pitchHeight);
    }
  }, [showPitchOverlay]);

  // Rotate and fit bounds of the map to the pitch when showFieldMode is active
  useEffect(() => {
    if (showFieldMode && pitchCenter && mapRef.current) {
      // 1. Rotate map container to align the pitch with the screen edges
      const targetHeading = (360 - pitchAngle) % 360;
      setMapHeading(targetHeading);

      // 2. Center map over pitch center
      setUserMapCenter(null);

      // 3. Zoom/crop view to pitch bounds based on viewport size and field dimensions
      let targetZoom = 18;
      if (viewportRef.current) {
        const viewportWidth = viewportRef.current.clientWidth || 800;
        const viewportHeight = viewportRef.current.clientHeight || 450;
        const lat = pitchCenter.lat;
        const cosLat = Math.cos((lat * Math.PI) / 180);
        
        // We want the field to fit the viewport nicely.
        // Let's use a 90% fill factor.
        const zWidth = Math.log2((0.90 * viewportWidth * 156543.03392 * cosLat) / pitchWidth);
        const zHeight = Math.log2((0.90 * viewportHeight * 156543.03392 * cosLat) / pitchHeight);
        
        targetZoom = Math.min(zWidth, zHeight);
        targetZoom = Math.max(12, Math.min(21, targetZoom));
      }
      setMapZoom(targetZoom);
    } else if (!showFieldMode && mapRef.current) {
      // Return to normal map (no rotation)
      setMapHeading(0);
      setUserMapCenter(null);
      setMapZoom(18); // default zoom for normal mode
    }
  }, [showFieldMode, pitchCenter, mapReady, pitchAngle, pitchWidth, pitchHeight]);

  // Compute stats and visual configuration for all tracks
  const displayTracks = useMemo<DisplayTrack[]>(() => {
    const startSecs = matchDetails?.real_start_time ? timeToSeconds(matchDetails.real_start_time) : 0;
    const endSecs = matchDetails?.real_end_time ? timeToSeconds(matchDetails.real_end_time) : 0;

    const list = [...savedTracks];
    if (selectedFileForUpload) {
      list.push({
        id: 'preview',
        match_id: matchId,
        participant_id: null,
        user_id: null,
        player_name: `🔍 Vista Previa: ${selectedFileForUpload.player_name}`,
        points: selectedFileForUpload.points,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    return list.map((t, idx) => {
      let filteredPoints = t.points.filter(p => {
        const ptSecs = timeToSeconds(p.time);
        const afterStart = startSecs === 0 || ptSecs >= startSecs;
        const beforeEnd = endSecs === 0 || ptSecs <= endSecs;
        return afterStart && beforeEnd;
      });

      if (downsampleRate > 1) {
        filteredPoints = filteredPoints.filter((_, pIdx) => pIdx % downsampleRate === 0);
      }

      return {
        id: t.id,
        player_name: t.player_name,
        participant_id: t.participant_id,
        points: filteredPoints,
        color: t.id === 'preview' ? '#D63415' : getTrackColor(idx),
        visible: visibleTrackIds.has(t.id),
        stats: computeStatsForPoints(filteredPoints)
      };
    });
  }, [savedTracks, visibleTrackIds, matchDetails, selectedFileForUpload, downsampleRate]);

  const visibleTracks = useMemo(() => {
    return displayTracks.filter(t => t.visible);
  }, [displayTracks]);

  // Find max points length among visible tracks to drive shared timeline
  const maxTimelineLength = useMemo(() => {
    if (visibleTracks.length === 0) return 0;
    return Math.max(...visibleTracks.map(t => t.points.length));
  }, [visibleTracks]);

  // Apply sorting
  const sortedTracks = useMemo(() => {
    if (!sortField) return displayTracks;
    
    return [...displayTracks].sort((a, b) => {
      let valA: any = a.player_name.toLowerCase();
      let valB: any = b.player_name.toLowerCase();

      if (sortField === 'distance') {
        valA = parseFloat(a.stats.distanceKm);
        valB = parseFloat(b.stats.distanceKm);
      } else if (sortField === 'maxSpeed') {
        valA = parseFloat(a.stats.maxSpeed);
        valB = parseFloat(b.stats.maxSpeed);
      } else if (sortField === 'avgSpeed') {
        valA = parseFloat(a.stats.avgSpeed);
        valB = parseFloat(b.stats.avgSpeed);
      } else if (sortField === 'sprints') {
        valA = a.stats.sprints;
        valB = b.stats.sprints;
      } else if (sortField === 'duration') {
        valA = a.stats.durationMin;
        valB = b.stats.durationMin;
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [displayTracks, sortField, sortAsc]);

  const toggleTrackVisibility = (trackId: string) => {
    setVisibleTrackIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const toggleAllVisibility = () => {
    setVisibleTrackIds(prev => {
      const next = new Set<string>();
      if (prev.size < displayTracks.length) {
        displayTracks.forEach(t => next.add(t.id));
      }
      return next;
    });
  };

  // Replay animation loop
  useEffect(() => {
    if (isPlaying && maxTimelineLength > 0) {
      timerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= maxTimelineLength - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000 / playSpeed);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, maxTimelineLength, playSpeed]);

  // CSV parsing logic
  const parseCSV = (text: string): GPSPoint[] => {
    const lines = text.split('\n');
    const result: GPSPoint[] = [];
    for (let i = 1; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;
      const spaceIndex = line.indexOf(' ');
      if (spaceIndex > 0 && line.substring(0, spaceIndex).includes(':')) {
        line = line.substring(spaceIndex + 1).trim();
      }
      const parts = line.split(',');
      if (parts.length < 6) continue;
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      const speed = parseFloat(parts[2]);
      const sats = parseInt(parts[3], 10);
      const date = parts[4];
      const time = parts[5];
      if (isNaN(lat) || isNaN(lng) || isNaN(speed)) continue;
      result.push({ lat, lng, speed, sats, date, time });
    }
    return result;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const parsed = parseCSV(text);
        if (parsed.length === 0) {
          setErrorMsg("El archivo CSV no contiene datos válidos.");
        } else {
          setSelectedFileForUpload({
            match_id: matchId,
            player_name: file.name.replace('.csv', ''),
            points: parsed
          });
          setVisibleTrackIds(prev => {
            const next = new Set(prev);
            next.add('preview');
            return next;
          });
          setShowSaveModal(true);

          if (parsed.length > 0) {
            const avgLat = parsed.reduce((acc, p) => acc + p.lat, 0) / parsed.length;
            const avgLng = parsed.reduce((acc, p) => acc + p.lng, 0) / parsed.length;
            setPitchCenter({ lat: avgLat, lng: avgLng });
            setUserMapCenter({ lat: avgLat, lng: avgLng });
          }
        }
      } catch (err) {
        setErrorMsg("Error al procesar el archivo CSV.");
      }
      setLoading(false);
    };
    reader.readAsText(file);
  };

  const handleSaveToSupabase = async () => {
    if (!selectedFileForUpload) return;
    if (!selectedParticipantId) {
      setErrorMsg("Selecciona un jugador para guardar la sesión.");
      return;
    }

    const participant = participants.find(p => p.id === selectedParticipantId);
    if (!participant) return;

    setSaving(true);
    setErrorMsg(null);

    try {
      const trackData = {
        match_id: matchId,
        participant_id: participant.id,
        user_id: participant.user_id,
        player_name: participant.user_name,
        points: selectedFileForUpload.points
      };

      const saved = await saveGPSTrack(trackData, fromTable);
      
      setSavedTracks(prev => {
        const filtered = prev.filter(t => t.participant_id !== participant.id);
        return [...filtered, saved];
      });

      // Enable visibility for the newly loaded track and remove preview
      setVisibleTrackIds(prev => {
        const next = new Set(prev);
        next.delete('preview');
        next.add(saved.id);
        return next;
      });

      setShowSaveModal(false);
      setSelectedFileForUpload(null);
      setSelectedParticipantId('');
      alert("¡Rastro GPS guardado y asociado con éxito!");
    } catch (err: any) {
      console.error('Error saving GPS track:', err);
      setErrorMsg("Error al guardar los datos: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTrack = async (trackId: string, playerName: string) => {
    if (trackId === 'preview') {
      setSelectedFileForUpload(null);
      setShowSaveModal(false);
      return;
    }
    if (!confirm(`¿Seguro que quieres eliminar la sesión GPS de ${playerName}?`)) return;
    try {
      await deleteGPSTrack(trackId, fromTable);
      setSavedTracks(prev => prev.filter(t => t.id !== trackId));
      setVisibleTrackIds(prev => {
        const next = new Set(prev);
        next.delete(trackId);
        return next;
      });
    } catch (err) {
      alert("Error al borrar la sesión.");
    }
  };

  // Shared rotated points calculations (Only translate to align centers, DO NOT rotate because real-world coordinates and satellite are already aligned)
  const getTrackRotatedPoints = (track: DisplayTrack) => {
    if (track.points.length === 0) return [];
    const avgLat = track.points.reduce((acc, p) => acc + p.lat, 0) / track.points.length;
    const avgLng = track.points.reduce((acc, p) => acc + p.lng, 0) / track.points.length;
    const dLat = pitchCenter ? pitchCenter.lat - avgLat : 0;
    const dLng = pitchCenter ? pitchCenter.lng - avgLng : 0;

    return track.points.map(p => {
      return {
        lat: p.lat + dLat,
        lng: p.lng + dLng,
      };
    });
  };

  // Pitch drawing parameters for Google Maps
  const pitchLines = useMemo(() => {
    if (!pitchCenter) return null;
    const { lat, lng } = pitchCenter;
    const halfW = pitchWidth / 2;
    const halfH = pitchHeight / 2;

    const outerBoundary = [
      meterOffsetToLatLng(lat, lng, -halfW, -halfH, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW, -halfH, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW, halfH, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW, halfH, pitchAngle),
    ];

    const midfieldLine = [
      meterOffsetToLatLng(lat, lng, 0, -halfH, pitchAngle),
      meterOffsetToLatLng(lat, lng, 0, halfH, pitchAngle),
    ];

    const centerCircle: { lat: number; lng: number }[] = [];
    const rCircle = 9.15;
    for (let i = 0; i <= 36; i++) {
      const theta = (i * 10 * Math.PI) / 180;
      centerCircle.push(
        meterOffsetToLatLng(lat, lng, rCircle * Math.cos(theta), rCircle * Math.sin(theta), pitchAngle)
      );
    }

    const leftPenaltyBox = [
      meterOffsetToLatLng(lat, lng, -halfW, -20.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW + 16.5, -20.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW + 16.5, 20.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW, 20.15, pitchAngle),
    ];

    const rightPenaltyBox = [
      meterOffsetToLatLng(lat, lng, halfW, -20.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW - 16.5, -20.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW - 16.5, 20.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW, 20.15, pitchAngle),
    ];

    const leftGoalBox = [
      meterOffsetToLatLng(lat, lng, -halfW, -9.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW + 5.5, -9.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW + 5.5, 9.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW, 9.15, pitchAngle),
    ];

    const rightGoalBox = [
      meterOffsetToLatLng(lat, lng, halfW, -9.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW - 5.5, -9.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW - 5.5, 9.15, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW, 9.15, pitchAngle),
    ];

    return { outerBoundary, midfieldLine, centerCircle, leftPenaltyBox, rightPenaltyBox, leftGoalBox, rightGoalBox };
  }, [pitchCenter, pitchAngle, pitchWidth, pitchHeight]);

  const pitchMaskPolygons = useMemo(() => {
    if (!pitchCenter || !showFieldMode || showPitchOverlay) return null;
    const { lat, lng } = pitchCenter;
    const halfW = pitchWidth / 2;
    const halfH = pitchHeight / 2;
    const D = 10000; // 10 km margin to cover viewport limits

    const p1 = meterOffsetToLatLng(lat, lng, -halfW, -halfH, pitchAngle);
    const p2 = meterOffsetToLatLng(lat, lng, halfW, -halfH, pitchAngle);
    const p3 = meterOffsetToLatLng(lat, lng, halfW, halfH, pitchAngle);
    const p4 = meterOffsetToLatLng(lat, lng, -halfW, halfH, pitchAngle);

    // 1. Top Mask: Area above the field
    const topMask = [
      p1,
      p2,
      meterOffsetToLatLng(lat, lng, halfW, -halfH - D, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW, -halfH - D, pitchAngle)
    ];

    // 2. Bottom Mask: Area below the field
    const bottomMask = [
      p4,
      p3,
      meterOffsetToLatLng(lat, lng, halfW, halfH + D, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW, halfH + D, pitchAngle)
    ];

    // 3. Left Mask: Area to the left of the field
    const leftMask = [
      meterOffsetToLatLng(lat, lng, -halfW, -halfH - D, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW, halfH + D, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW - D, halfH + D, pitchAngle),
      meterOffsetToLatLng(lat, lng, -halfW - D, -halfH - D, pitchAngle)
    ];

    // 4. Right Mask: Area to the right of the field
    const rightMask = [
      meterOffsetToLatLng(lat, lng, halfW, -halfH - D, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW, halfH + D, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW + D, halfH + D, pitchAngle),
      meterOffsetToLatLng(lat, lng, halfW + D, -halfH - D, pitchAngle)
    ];

    return [topMask, bottomMask, leftMask, rightMask];
  }, [pitchCenter, pitchAngle, pitchWidth, pitchHeight, showPitchOverlay, showFieldMode]);

  const latLngToFieldCoords = React.useCallback((lat: number, lng: number) => {
    if (!pitchCenter) return null;
    const east = (lng - pitchCenter.lng) * 83962;
    const north = (lat - pitchCenter.lat) * 111320;
    const rad = (pitchAngle * Math.PI) / 180;
    const fx = east * Math.cos(rad) + north * Math.sin(rad);
    const fy = -east * Math.sin(rad) + north * Math.cos(rad);
    return { x: fx, y: fy };
  }, [pitchCenter, pitchAngle]);

  // Load and cache Google Maps Static Satellite Image of the pitch
  const [mapImageLoaded, setMapImageLoaded] = useState(false);
  const mapImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!pitchCenter || !showFieldMode || !GOOGLE_MAPS_API_KEY) return;
    
    // Calculate the target zoom level for the static map
    let targetZoom = 18;
    if (viewportRef.current) {
      const viewportWidth = viewportRef.current.clientWidth || 800;
      const viewportHeight = viewportRef.current.clientHeight || 450;
      const lat = pitchCenter.lat;
      const cosLat = Math.cos((lat * Math.PI) / 180);
      
      const zWidth = Math.log2((0.90 * viewportWidth * 156543.03392 * cosLat) / pitchWidth);
      const zHeight = Math.log2((0.90 * viewportHeight * 156543.03392 * cosLat) / pitchHeight);
      
      targetZoom = Math.min(zWidth, zHeight);
      targetZoom = Math.max(12, Math.min(21, targetZoom));
    }
    
    const roundedZoom = Math.round(targetZoom);
    const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${pitchCenter.lat},${pitchCenter.lng}&zoom=${roundedZoom}&size=640x640&scale=2&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`;
    
    setMapImageLoaded(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      mapImageRef.current = img;
      setMapImageLoaded(true);
    };
    img.src = staticMapUrl;
  }, [pitchCenter, pitchWidth, pitchHeight, showFieldMode, GOOGLE_MAPS_API_KEY]);

  // Handle dynamic canvas resizing to match viewport parent
  useEffect(() => {
    if (!showFieldMode || !canvasRef.current) return;
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [showFieldMode]);

  // Drawing Canvas Field representation with static satellite image background
  useEffect(() => {
    if (!showFieldMode || !canvasRef.current || !pitchCenter || visibleTracks.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const halfL = pitchWidth / 2;
    const halfW = pitchHeight / 2;
    const scale = Math.min((W - 48) / pitchWidth, (H - 48) / pitchHeight);
    const offX = W / 2;
    const offY = H / 2;
    const toC = (fx: number, fy: number) => ({ cx: offX + fx * scale, cy: offY - fy * scale });

    ctx.clearRect(0, 0, W, H);
    
    // Fill background with #FAFBF4
    ctx.fillStyle = '#FAFBF4';
    ctx.fillRect(0, 0, W, H);

    // Draw the green background of the field (upright/horizontal)
    ctx.fillStyle = '#1e5c1e';
    ctx.fillRect(offX - halfL * scale, offY - halfW * scale, pitchWidth * scale, pitchHeight * scale);

    // Draw the satellite image (rotated and clipped)
    if (mapImageLoaded && mapImageRef.current) {
      const img = mapImageRef.current;
      const imgW = img.width;
      const imgH = img.height;
      
      const lat = pitchCenter.lat;
      const cosLat = Math.cos((lat * Math.PI) / 180);
      const zWidth = Math.log2((0.90 * W * 156543.03392 * cosLat) / pitchWidth);
      const zHeight = Math.log2((0.90 * H * 156543.03392 * cosLat) / pitchHeight);
      let targetZoom = Math.min(zWidth, zHeight);
      targetZoom = Math.max(12, Math.min(21, targetZoom));
      const roundedZoom = Math.round(targetZoom);
      
      const metersPerPixel = (156543.03392 * cosLat) / Math.pow(2, roundedZoom);
      const imageMetersPerPixel = metersPerPixel / 2; // scale = 2
      const drawScale = imageMetersPerPixel * scale;
      const drawW = imgW * drawScale;
      const drawH = imgH * drawScale;
      
      ctx.save();
      // Center at Canvas middle
      ctx.translate(offX, offY);
      
      // Clip to the horizontal field boundary (relative to the centered origin)
      ctx.beginPath();
      ctx.rect(-halfL * scale, -halfW * scale, pitchWidth * scale, pitchHeight * scale);
      ctx.clip();
      
      // Rotate by pitchAngle so the field in the satellite image is horizontal
      const angleRad = (pitchAngle * Math.PI) / 180;
      ctx.rotate(angleRad);
      
      // Draw image centered
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }

    // Draw white tactical lines (upright/horizontal)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    
    // Outer boundary
    ctx.beginPath();
    ctx.rect(offX - halfL * scale, offY - halfW * scale, pitchWidth * scale, pitchHeight * scale);
    ctx.stroke();

    // Midfield line
    ctx.beginPath();
    const { cx: m1x, cy: m1y } = toC(0, -halfW);
    const { cx: m2x, cy: m2y } = toC(0, halfW);
    ctx.moveTo(m1x, m1y);
    ctx.lineTo(m2x, m2y);
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(offX, offY, 9.15 * scale, 0, Math.PI * 2);
    ctx.stroke();
    
    // Center spot
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(offX, offY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Penalty areas
    const penW = 40.32 / 2;
    const penH = 16.5;
    const goalW = 18.32 / 2;
    const goalH = 5.5;

    // Left penalty area and goal area
    ctx.beginPath();
    const ptsL = [[-halfL, -penW], [-halfL + penH, -penW], [-halfL + penH, penW], [-halfL, penW]];
    ptsL.forEach(([x, y], i) => {
      const { cx, cy } = toC(x, y);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    
    ctx.beginPath();
    const ptsGoalL = [[-halfL, -goalW], [-halfL + goalH, -goalW], [-halfL + goalH, goalW], [-halfL, goalW]];
    ptsGoalL.forEach(([x, y], i) => {
      const { cx, cy } = toC(x, y);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    });
    ctx.stroke();

    // Right penalty area and goal area
    ctx.beginPath();
    const ptsR = [[halfL, -penW], [halfL - penH, -penW], [halfL - penH, penW], [halfL, penW]];
    ptsR.forEach(([x, y], i) => {
      const { cx, cy } = toC(x, y);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    
    ctx.beginPath();
    const ptsGoalR = [[halfL, -goalW], [halfL - goalH, -goalW], [halfL - goalH, goalW], [halfL, goalW]];
    ptsGoalR.forEach(([x, y], i) => {
      const { cx, cy } = toC(x, y);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    });
    ctx.stroke();

    // Draw penalty arcs (D-box)
    ctx.beginPath();
    const centerSpotLX = offX + (-halfL + 11) * scale;
    ctx.arc(centerSpotLX, offY, 9.15 * scale, -Math.acos(5.5 / 9.15), Math.acos(5.5 / 9.15));
    ctx.stroke();

    ctx.beginPath();
    const centerSpotRX = offX + (halfL - 11) * scale;
    ctx.arc(centerSpotRX, offY, 9.15 * scale, Math.PI - Math.acos(5.5 / 9.15), Math.PI + Math.acos(5.5 / 9.15));
    ctx.stroke();

    // Draw paths for all visible tracks on Canvas
    visibleTracks.forEach(t => {
      const avgLat = t.points.reduce((acc, p) => acc + p.lat, 0) / t.points.length;
      const avgLng = t.points.reduce((acc, p) => acc + p.lng, 0) / t.points.length;
      const dLat = pitchCenter ? pitchCenter.lat - avgLat : 0;
      const dLng = pitchCenter ? pitchCenter.lng - avgLng : 0;

      // Heatmap rendering logic (accumulating density)
      if (showHeatmap) {
        const GRID = 30;
        const density = new Float32Array(GRID*GRID);
        let maxD = 0;
        t.points.forEach(p => {
          const fc = latLngToFieldCoords(p.lat + dLat, p.lng + dLng);
          if (!fc) return;
          const gx = Math.floor(((fc.x/halfL)+1)/2*(GRID-1));
          const gy = Math.floor(((fc.y/halfW)+1)/2*(GRID-1));
          if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID) {
            density[gy*GRID+gx]++;
            if (density[gy*GRID+gx] > maxD) maxD = density[gy*GRID+gx];
          }
        });
        if (maxD > 0) {
          const cw = (pitchWidth*scale)/GRID;
          const ch = (pitchHeight*scale)/GRID;
          for (let gy = 0; gy < GRID; gy++) {
            for (let gx = 0; gx < GRID; gx++) {
              const d = density[gy*GRID+gx]/maxD;
              if (d < 0.05) continue;
              const fx = (gx/(GRID-1))*pitchWidth-halfL;
              const fy = (gy/(GRID-1))*pitchHeight-halfW;
              const { cx, cy } = toC(fx, fy);
              ctx.fillStyle = `${t.color}${Math.floor(d * 180).toString(16).padStart(2, '0')}`;
              ctx.fillRect(cx-cw/2, cy-ch/2, cw, ch);
            }
          }
        }
      } else {
        // Draw route line
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let started = false;
        t.points.forEach(p => {
          const fc = latLngToFieldCoords(p.lat + dLat, p.lng + dLng);
          if (!fc) return;
          const { cx, cy } = toC(fc.x, fc.y);
          if (!started) {
            ctx.moveTo(cx, cy);
            started = true;
          } else {
            ctx.lineTo(cx, cy);
          }
        });
        ctx.stroke();
      }

      // Render player marker on canvas
      const idx = Math.min(currentIndex, t.points.length - 1);
      const cp = t.points[idx];
      if (cp) {
        const fc = latLngToFieldCoords(cp.lat + dLat, cp.lng + dLng);
        if (fc) {
          const { cx, cy } = toC(fc.x, fc.y);
          ctx.fillStyle = t.color;
          ctx.beginPath();
          ctx.arc(cx, cy, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    });
  }, [showFieldMode, visibleTracks, currentIndex, pitchCenter, pitchAngle, pitchWidth, pitchHeight, showHeatmap, latLngToFieldCoords, mapImageLoaded]);

  // Speed chart path helper for the SVG speed indicator (using first visible track or average speed)
  const speedChartPath = useMemo(() => {
    if (visibleTracks.length === 0 || visibleTracks[0].points.length === 0) return "";
    const w = 600;
    const h = 80;
    const leadPts = visibleTracks[0].points;
    const maxSpeed = Math.max(...leadPts.map((p) => p.speed), 10);
    return leadPts
      .map((p, idx) => {
        const x = (idx / (leadPts.length - 1)) * w;
        const y = h - (p.speed / maxSpeed) * h;
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  }, [visibleTracks]);

  // Table header sort handler
  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc(a => !a);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  if (loadError) {
    return (
      <Card style={styles.card}>
        <Text style={styles.errorText}>Error al cargar el mapa de Google</Text>
      </Card>
    );
  }

  if (!isLoaded) {
    return (
      <Card style={styles.card}>
        <ActivityIndicator size="large" color="#17713A" />
        <Text style={styles.loadingText}>Cargando entorno de mapas...</Text>
      </Card>
    );
  }

  return (
    <View style={styles.fullscreenWrapper}>
      {displayTracks.length === 0 && !selectedFileForUpload ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', maxWidth: '600px', margin: '40px auto' }}>
          
          {/* Dropzone for manual CSV import */}
          <div style={webStyles.dropzone}>
            <Ionicons name="cloud-upload-outline" size={48} color="#4A6353" />
            <h3 style={webStyles.dropzoneTitle}>Sube tu archivo de partido</h3>
            <p style={webStyles.dropzoneText}>
              Selecciona el archivo <b>.csv</b> descargado de tu rastreador GPS.
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={webStyles.fileInput}
              id="gps-upload-input"
            />
            <label htmlFor="gps-upload-input" style={webStyles.uploadButton}>
              Seleccionar Archivo
            </label>
            {loading && <ActivityIndicator color="#17713A" style={{ marginTop: 12 }} />}
            {errorMsg && <p style={{ color: C.danger, marginTop: 12, fontSize: '13px' }}>{errorMsg}</p>}
          </div>

          <Text style={styles.emptyHintText}>No hay trayectos guardados para este partido. Conecta un GPS o sube un CSV para comenzar.</Text>
        </div>
      ) : (
        <View style={styles.container}>
          
          {/* Metrics comparison table */}
          <div style={webStyles.tableContainer}>
            <div style={webStyles.tableHeaderBar}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <SectionTitle style={{ margin: 0 }}>Rendimiento de los Jugadores</SectionTitle>
                <button style={webStyles.toggleAllBtn} onClick={toggleAllVisibility}>
                  {visibleTrackIds.size === displayTracks.length ? "Ocultar Todos" : "Mostrar Todos"}
                </button>
                {matchDetails?.real_start_time && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: '#DEEDEF',
                    border: '1px solid #16606B',
                    padding: '4px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#16606B'
                  }}>
                    <Ionicons name="time-outline" size={13} color="#16606B" />
                    <span>GPS recortado: {matchDetails.real_start_time} - {matchDetails.real_end_time || 'Fin'}</span>
                  </div>
                )}
              </div>

              {/* Manual import upload button */}
              <div style={{ position: 'relative' }}>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  style={webStyles.fileInput}
                  id="gps-table-upload-input"
                />
                <label htmlFor="gps-table-upload-input" style={webStyles.importBtn}>
                  <Ionicons name="add-circle" size={16} />
                  <span>Importar CSV</span>
                </label>
              </div>
            </div>

            <table style={webStyles.metricsTable}>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>Vis.</th>
                  <th style={webStyles.thSortable} onClick={() => handleSort('player_name')}>
                    Jugador {sortField === 'player_name' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th style={webStyles.thSortable} onClick={() => handleSort('distance')}>
                    Distancia {sortField === 'distance' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th style={webStyles.thSortable} onClick={() => handleSort('maxSpeed')}>
                    Vel. Máx {sortField === 'maxSpeed' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th style={webStyles.thSortable} onClick={() => handleSort('avgSpeed')}>
                    Vel. Media {sortField === 'avgSpeed' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th style={webStyles.thSortable} onClick={() => handleSort('sprints')}>
                    Sprints {sortField === 'sprints' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th style={webStyles.thSortable} onClick={() => handleSort('duration')}>
                    Duración {sortField === 'duration' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th style={{ width: '60px', textAlign: 'center' }}>Borrar</th>
                </tr>
              </thead>
              <tbody>
                {sortedTracks.map(t => (
                  <tr key={t.id} style={t.visible ? webStyles.trActive : {}}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={t.visible}
                        onChange={() => toggleTrackVisibility(t.id)}
                        style={{ cursor: 'pointer', accentColor: t.color }}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ ...webStyles.colorIndicator, backgroundColor: t.color }} />
                        <span style={{ fontWeight: 600 }}>{t.player_name}</span>
                      </div>
                    </td>
                    <td>{t.stats.distanceKm} km</td>
                    <td>{t.stats.maxSpeed} km/h</td>
                    <td>{t.stats.avgSpeed} km/h</td>
                    <td>{t.stats.sprints}</td>
                    <td>{t.stats.durationMin} min</td>
                    <td style={{ textAlign: 'center' }}>
                      <button style={webStyles.deleteTrackBtn} onClick={() => handleDeleteTrack(t.id, t.player_name)}>
                        <Ionicons name="trash-outline" size={15} color={C.danger} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Map / Pitch Canvas Container */}
          <div ref={viewportRef} style={webStyles.mapContainer}>
            
            {/* Top right floating controls */}
            <div style={webStyles.alignControlsToggle}>
              <button
                onClick={() => setShowHeatmap(!showHeatmap)}
                style={{
                  ...webStyles.controlBtn,
                  backgroundColor: showHeatmap ? '#17713A' : '#FFFFFF',
                  color: showHeatmap ? '#FFFFFF' : '#14251A',
                  borderRadius: '8px',
                  border: '1px solid #0D2015',
                }}
              >
                <Ionicons name="flame" size={16} style={{ marginRight: 6, color: showHeatmap ? '#FFFFFF' : '#D63415' }} />
                {showHeatmap ? "Ocultar Calor" : "Mapa de Calor"}
              </button>

              <button
                onClick={() => setShowPitchOverlay(!showPitchOverlay)}
                style={{
                  ...webStyles.controlBtn,
                  backgroundColor: showPitchOverlay ? '#17713A' : '#FFFFFF',
                  color: showPitchOverlay ? '#FFFFFF' : '#14251A',
                  borderRadius: '8px',
                  border: '1px solid #0D2015',
                }}
              >
                <Ionicons name="grid-outline" size={16} style={{ marginRight: 6 }} />
                {showPitchOverlay ? "Ocultar Alineador" : "Alinear Campo"}
              </button>

              {pitchCenter && (
                <button
                  onClick={() => setShowFieldMode(f => !f)}
                  style={{
                    ...webStyles.controlBtn,
                    backgroundColor: showFieldMode ? '#17713A' : '#FFFFFF',
                    color: showFieldMode ? '#FFFFFF' : '#14251A',
                    borderRadius: '8px',
                    border: '1px solid #0D2015',
                  }}
                >
                  <Ionicons name="easel-outline" size={16} style={{ marginRight: 6 }} />
                  {showFieldMode ? 'Vista Satélite' : 'Vista Campo'}
                </button>
              )}
            </div>

            {/* Manual Upload Participant Selection Dialog */}
            {showSaveModal && selectedFileForUpload && (
              <div style={webStyles.floatingSavePanel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={webStyles.alignPanelTitle}>Asociar Trayecto GPS</h4>
                  <button 
                    onClick={() => { setShowSaveModal(false); setSelectedFileForUpload(null); }} 
                    style={{ 
                      background: 'transparent', 
                      border: 'none', 
                      cursor: 'pointer',
                      fontSize: '20px',
                      fontWeight: 'bold',
                      color: '#14251A',
                      padding: '4px',
                      lineHeight: '1'
                    }}
                    title="Cerrar"
                  >
                    ✕
                  </button>
                </div>
                <p style={webStyles.alignPanelSub}>
                  Asigna la sesión del archivo a uno de los participantes apuntados al partido.
                </p>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#4A6353', marginBottom: 6 }}>Seleccionar Jugador</label>
                  <select
                    value={selectedParticipantId}
                    onChange={(e) => setSelectedParticipantId(e.target.value)}
                    style={webStyles.dropdownSelect}
                  >
                    <option value="">-- Elegir Jugador --</option>
                    {participants.map(p => {
                      const hasTrack = savedTracks.some(t => t.participant_id === p.id);
                      return (
                        <option key={p.id} value={p.id}>
                          {p.user_name} {hasTrack ? '✓ (Sobrescribir)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <button
                  onClick={handleSaveToSupabase}
                  disabled={saving || !selectedParticipantId}
                  style={{
                    ...webStyles.uploadButton,
                    width: '100%',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    backgroundColor: saving ? '#84957F' : '#17713A',
                    cursor: saving ? 'default' : 'pointer'
                  }}
                >
                  {saving ? 'Guardando...' : 'Confirmar Guardar'}
                </button>
              </div>
            )}

            {/* Pitch alignment sliders */}
            {showPitchOverlay && (
              <div style={webStyles.floatingAlignPanel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isControlsOpen ? 12 : 0 }}>
                  <div>
                    <h4 style={webStyles.alignPanelTitle}>Ajustar Campo</h4>
                    {isControlsOpen && (
                      <p style={webStyles.alignPanelSub}>
                        Usa las flechas para ajuste fino o desliza para rotar.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setIsControlsOpen(!isControlsOpen)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', outline: 'none' }}
                  >
                    <Ionicons name={isControlsOpen ? "chevron-down" : "chevron-up"} size={20} color="#14251A" />
                  </button>
                </div>

                {isControlsOpen && (
                  <>
                    <div style={{ ...webStyles.sliderGroup, marginBottom: 16 }}>
                      <div style={webStyles.sliderRow}>
                        <label style={webStyles.sliderLabel}>Ajuste Fino</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button style={webStyles.nudgeBtn} onClick={() => setPitchCenter(p => p ? { ...p, lat: p.lat + 0.00001 } : null)}>↑ N</button>
                          <button style={webStyles.nudgeBtn} onClick={() => setPitchCenter(p => p ? { ...p, lat: p.lat - 0.00001 } : null)}>↓ S</button>
                          <button style={webStyles.nudgeBtn} onClick={() => setPitchCenter(p => p ? { ...p, lng: p.lng + 0.00001 } : null)}>→ E</button>
                          <button style={webStyles.nudgeBtn} onClick={() => setPitchCenter(p => p ? { ...p, lng: p.lng - 0.00001 } : null)}>← O</button>
                        </div>
                      </div>
                    </div>
                    <div style={webStyles.sliderGroup}>
                      <div style={webStyles.sliderRow}>
                        <label style={webStyles.sliderLabel}>Rotación Campo: {pitchAngle}°</label>
                        <input type="range" min="0" max="360" value={pitchAngle}
                          onChange={(e) => setPitchAngle(parseInt(e.target.value, 10))}
                          style={webStyles.sliderInput} />
                      </div>
                      <div style={webStyles.sliderRow}>
                        <label style={webStyles.sliderLabel}>Rotación Vista: {mapHeading}°</label>
                        <input type="range" min="0" max="360" value={mapHeading}
                          onChange={(e) => setMapHeading(parseInt(e.target.value, 10))}
                          style={webStyles.sliderInput} />
                      </div>
                      <div style={webStyles.sliderRow}>
                        <button
                          style={{ ...webStyles.nudgeBtn, width: '100%', padding: '6px 12px', marginTop: 4 }}
                          onClick={() => { setPitchAngle(mapHeading); }}
                        >
                          🧭 Alinear campo con la vista
                        </button>
                      </div>
                      <div style={webStyles.sliderRow}>
                        <label style={webStyles.sliderLabel}>Largo: {pitchWidth}m</label>
                        <input
                          type="range"
                          min="10"
                          max="130"
                          value={pitchWidth}
                          onChange={(e) => setPitchWidth(parseInt(e.target.value, 10))}
                          style={webStyles.sliderInput}
                        />
                      </div>
                      <div style={webStyles.sliderRow}>
                        <label style={webStyles.sliderLabel}>Ancho: {pitchHeight}m</label>
                        <input
                          type="range"
                          min="10"
                          max="90"
                          value={pitchHeight}
                          onChange={(e) => setPitchHeight(parseInt(e.target.value, 10))}
                          style={webStyles.sliderInput}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Satélite / Representation Mode Viewports */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
              {!showFieldMode ? (
                // Google Map in Satellite View (upright, interactive)
                <div style={{ width: '100%', height: '100%' }}>
                  <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '100%' }}
                    onLoad={(map) => { mapRef.current = map; map.setTilt(0); setMapReady(true); }}
                    onDragEnd={() => {
                      if (mapRef.current) setUserMapCenter(mapRef.current.getCenter()?.toJSON() || null);
                    }}
                    onZoomChanged={() => {
                      if (mapRef.current && mapReady) {
                        const newZoom = mapRef.current.getZoom();
                        if (newZoom !== undefined && newZoom !== mapZoom) {
                          setMapZoom(newZoom);
                        }
                      }
                    }}
                    center={
                      userMapCenter ||
                      pitchCenter ||
                      { lat: 41.3851, lng: 2.1734 }
                    }
                    zoom={mapZoom}
                    options={{
                      mapTypeId: 'satellite',
                      disableDefaultUI: true,
                      zoomControl: true,
                      tilt: 0,
                      gestureHandling: 'greedy',
                    }}
                  >
                    
                    {/* Draw Polylines and Markers for all selected visible players */}
                    {visibleTracks.map(t => {
                      const rotatedPath = getTrackRotatedPoints(t);
                      const currentIdx = Math.min(currentIndex, rotatedPath.length - 1);
                      const currentPoint = rotatedPath[currentIdx];

                      return (
                        <React.Fragment key={`elements-${t.id}`}>
                          {/* Route */}
                          {!showHeatmap && rotatedPath.length > 0 && (
                            <Polyline
                              path={rotatedPath}
                              options={{
                                strokeColor: t.color,
                                strokeOpacity: 0.8,
                                strokeWeight: 4
                              }}
                            />
                          )}

                          {/* Replay position marker */}
                          {currentPoint && (
                            <Marker
                              position={currentPoint}
                              title={t.player_name}
                              options={{
                                icon: {
                                  path: window.google.maps.SymbolPath.CIRCLE,
                                  fillColor: t.color,
                                  fillOpacity: 1,
                                  strokeColor: '#FFFFFF',
                                  strokeWeight: 2,
                                  scale: 8,
                                }
                              }}
                            />
                          )}

                          {/* Heatmap Layer */}
                          {rotatedPath.length > 0 && (
                            <HeatmapLayerF
                              data={showHeatmap ? rotatedPath.map(p => new window.google.maps.LatLng(p.lat, p.lng)) : []}
                              options={{
                                radius: 22,
                                opacity: 0.85
                              }}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Soccer pitch lines overlay */}
                    {pitchLines && (
                      <>
                        <Polygon
                          paths={pitchLines.outerBoundary}
                          options={{
                            strokeColor: '#FFFFFF',
                            strokeOpacity: showPitchOverlay ? 0.7 : 0.9,
                            strokeWeight: 2,
                            fillColor: showPitchOverlay ? '#FFFFFF' : 'transparent',
                            fillOpacity: showPitchOverlay ? 0.1 : 0,
                            clickable: false,
                          }}
                        />
                        <Polyline path={pitchLines.midfieldLine} options={{ strokeColor: '#FFFFFF', strokeOpacity: showPitchOverlay ? 0.7 : 0.9, strokeWeight: 2, clickable: false }} />
                        <Polyline path={pitchLines.centerCircle} options={{ strokeColor: '#FFFFFF', strokeOpacity: showPitchOverlay ? 0.7 : 0.9, strokeWeight: 2, clickable: false }} />
                        <Polyline path={pitchLines.leftPenaltyBox} options={{ strokeColor: '#FFFFFF', strokeOpacity: showPitchOverlay ? 0.7 : 0.9, strokeWeight: 2, clickable: false }} />
                        <Polyline path={pitchLines.rightPenaltyBox} options={{ strokeColor: '#FFFFFF', strokeOpacity: showPitchOverlay ? 0.7 : 0.9, strokeWeight: 2, clickable: false }} />
                        <Polyline path={pitchLines.leftGoalBox} options={{ strokeColor: '#FFFFFF', strokeOpacity: showPitchOverlay ? 0.7 : 0.9, strokeWeight: 2, clickable: false }} />
                        <Polyline path={pitchLines.rightGoalBox} options={{ strokeColor: '#FFFFFF', strokeOpacity: showPitchOverlay ? 0.7 : 0.9, strokeWeight: 2, clickable: false }} />
                        
                        {showPitchOverlay && pitchCenter && (
                          <Marker
                            position={pitchCenter}
                            draggable={true}
                            onDragEnd={(e) => {
                              const lat = e.latLng?.lat();
                              const lng = e.latLng?.lng();
                              if (lat && lng) setPitchCenter({ lat, lng });
                            }}
                            options={{ label: { text: "⚽ Mover Campo", color: '#FFFFFF', fontWeight: 'bold', fontSize: '12px' } }}
                          />
                        )}
                      </>
                    )}
                  </GoogleMap>
                </div>
              ) : (
                // Canvas View for Field Mode (Vista Campo)
                <canvas
                  ref={canvasRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    backgroundColor: '#FAFBF4'
                  }}
                />
              )}
            </div>
          </div>

          {/* Speed graphic chart */}
          {showChart && visibleTracks.length > 0 && (
            <div style={webStyles.chartContainer}>
              <div style={webStyles.chartHeader}>
                <span style={webStyles.chartTitle}>Velocidad a lo largo del tiempo ({visibleTracks[0].player_name})</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={webStyles.chartValue}>
                    Vel. Actual: <b>{visibleTracks[0].points[Math.min(currentIndex, visibleTracks[0].points.length - 1)]?.speed.toFixed(1)} km/h</b>
                  </span>
                  <button
                    onClick={() => setShowChart(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '4px',
                      color: '#4A6353',
                      outline: 'none',
                      fontSize: '18px',
                      fontWeight: 'bold',
                      lineHeight: '1'
                    }}
                    title="Cerrar gráfico"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <svg
                viewBox="0 0 600 80"
                style={webStyles.chartSvg}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const pct = clickX / rect.width;
                  const targetIdx = Math.min(maxTimelineLength - 1, Math.max(0, Math.floor(pct * maxTimelineLength)));
                  setCurrentIndex(targetIdx);
                }}
              >
                <line x1="0" y1="20" x2="600" y2="20" stroke={C.border} strokeWidth="1" strokeDasharray="4" />
                <line x1="0" y1="40" x2="600" y2="40" stroke={C.border} strokeWidth="1" strokeDasharray="4" />
                <line x1="0" y1="60" x2="600" y2="60" stroke={C.border} strokeWidth="1" strokeDasharray="4" />
                
                <path d={speedChartPath} fill="none" stroke={visibleTracks[0].color} strokeWidth="2.5" />
                
                <line
                  x1={maxTimelineLength > 1 ? (currentIndex / (maxTimelineLength - 1)) * 600 : 0}
                  y1="0"
                  x2={maxTimelineLength > 1 ? (currentIndex / (maxTimelineLength - 1)) * 600 : 0}
                  y2="80"
                  stroke="#EDAF00"
                  strokeWidth="2"
                />
              </svg>
            </div>
          )}

          {/* Replay animation playback bar */}
          <div style={webStyles.playbackRow}>
            <button
              onClick={() => { setIsPlaying(!isPlaying); setUserMapCenter(null); }}
              style={webStyles.playBtn}
              disabled={maxTimelineLength === 0}
            >
              <Ionicons name={isPlaying ? "pause" : "play"} size={20} color="#FFFFFF" />
            </button>

            <input
              type="range"
              min="0"
              max={maxTimelineLength > 0 ? maxTimelineLength - 1 : 0}
              value={currentIndex}
              onChange={(e) => setCurrentIndex(parseInt(e.target.value, 10))}
              disabled={maxTimelineLength === 0}
              style={webStyles.timelineSlider}
            />

            <div style={webStyles.timeIndicator}>
              {visibleTracks.length > 0 && visibleTracks[0].points[Math.min(currentIndex, visibleTracks[0].points.length - 1)]?.time || '00:00:00'}
            </div>

            <div style={webStyles.speedControl}>
              <select
                value={playSpeed}
                onChange={(e) => setPlaySpeed(parseInt(e.target.value, 10))}
                style={webStyles.speedSelect}
              >
                <option value={1}>Replay 1x</option>
                <option value={5}>Replay 5x</option>
                <option value={10}>Replay 10x</option>
                <option value={30}>Replay 30x</option>
              </select>
            </div>

            <div style={{ ...webStyles.speedControl, marginLeft: 4 }}>
              <select
                value={downsampleRate}
                onChange={(e) => setDownsampleRate(parseInt(e.target.value, 10))}
                style={webStyles.speedSelect}
              >
                <option value={1}>Detalle 100%</option>
                <option value={2}>Detalle 50%</option>
                <option value={5}>Detalle 20%</option>
                <option value={10}>Detalle 10%</option>
                <option value={20}>Detalle 5%</option>
              </select>
            </div>
            
            <button
              onClick={() => setShowChart(!showChart)}
              style={webStyles.clearBtn}
              disabled={visibleTracks.length === 0}
              title={showChart ? "Ocultar gráfico" : "Mostrar gráfico"}
            >
              <Ionicons name={showChart ? "stats-chart" : "stats-chart-outline"} size={20} color={showChart ? '#17713A' : '#4A6353'} />
            </button>
          </div>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: S.xl,
    padding: S.lg,
  },
  fullscreenWrapper: {
    flex: 1,
    backgroundColor: '#FAFBF4',
  },
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: 16,
  },
  loadingText: {
    fontFamily: FONTS.semibold,
    color: '#4A6353',
    textAlign: 'center',
    marginTop: S.md,
  },
  errorText: {
    fontFamily: FONTS.bold,
    color: C.danger,
    textAlign: 'center',
  },
  emptyHintText: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: '#4A6353',
    textAlign: 'center',
    marginTop: 20
  }
});

const webStyles: Record<string, React.CSSProperties> = {
  dropzone: {
    border: `2px dashed #0D2015`,
    borderRadius: '12px',
    padding: '40px 20px',
    textAlign: 'center',
    backgroundColor: '#FAFBF4',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
  dropzoneTitle: {
    fontFamily: 'Outfit, sans-serif',
    fontWeight: 700,
    fontSize: '18px',
    color: '#14251A',
    marginTop: '16px',
    marginBottom: '4px',
  },
  dropzoneText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '13px',
    color: '#4A6353',
    marginBottom: '20px',
  },
  fileInput: {
    display: 'none',
  },
  uploadButton: {
    backgroundColor: '#17713A',
    color: '#FFFFFF',
    padding: '10px 24px',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer',
    border: 'none',
    borderRadius: '8px',
  },
  tableContainer: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #DDE3CE',
    borderRadius: '16px',
    padding: '16px',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  tableHeaderBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px'
  },
  toggleAllBtn: {
    backgroundColor: '#EFF2E4',
    border: '1px solid #DDE3CE',
    borderRadius: '8px',
    padding: '6px 12px',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    fontSize: '12px',
    cursor: 'pointer',
    color: '#475569'
  },
  importBtn: {
    backgroundColor: '#14301F',
    color: '#FFFFFF',
    padding: '8px 16px',
    borderRadius: '8px',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  metricsTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'Inter, sans-serif',
    fontSize: '13.5px',
    color: '#14301F'
  },
  thSortable: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '2px solid #DDE3CE',
    color: '#475569',
    fontWeight: 700,
    cursor: 'pointer',
    userSelect: 'none'
  },
  trActive: {
    backgroundColor: '#FAFBF4'
  },
  colorIndicator: {
    width: '12px',
    height: '12px',
    borderRadius: '6px',
    border: '1px solid #FFFFFF',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.1)'
  },
  deleteTrackBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px'
  },
  mapContainer: {
    width: '100%',
    flex: 1,
    minHeight: '450px',
    backgroundColor: '#DDE3CE',
    position: 'relative',
    borderRadius: '16px',
    overflow: 'hidden',
    border: '1px solid #DDE3CE'
  },
  alignControlsToggle: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    zIndex: 10,
    display: 'flex',
    flexDirection: 'row',
    gap: '8px',
  },
  controlBtn: {
    border: 'none',
    padding: '8px 14px',
    fontWeight: 700,
    fontSize: '12px',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  floatingAlignPanel: {
    position: 'absolute',
    bottom: '24px',
    left: '24px',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: '14px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
    zIndex: 20,
    width: '320px',
    border: `1px solid #DDE3CE`,
    borderRadius: '12px'
  },
  alignPanelTitle: {
    fontWeight: 700,
    fontSize: '14px',
    color: '#14251A',
    margin: '0 0 4px 0',
  },
  alignPanelSub: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '12px',
    color: '#4A6353',
    margin: '0 0 16px 0',
    lineHeight: '16px',
  },
  sliderGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '20px',
  },
  sliderLabel: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    fontSize: '12.5px',
    color: '#475569',
    width: '120px',
    flexShrink: 0,
  },
  sliderInput: {
    flex: 1,
    accentColor: '#17713A',
    cursor: 'pointer',
  },
  nudgeBtn: {
    backgroundColor: '#EFF2E4',
    border: `1px solid #0D2015`,
    borderRadius: '6px',
    padding: '4px 8px',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    fontSize: '11px',
    cursor: 'pointer',
    color: '#14301F',
  },
  chartContainer: {
    backgroundColor: '#FFFFFF',
    border: `1px solid #DDE3CE`,
    borderRadius: '16px',
    padding: '16px',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  chartTitle: {
    fontFamily: 'Outfit, sans-serif',
    fontWeight: 700,
    fontSize: '12px',
    color: '#475569',
    textTransform: 'uppercase',
  },
  chartValue: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '12px',
    color: '#4A6353',
  },
  chartSvg: {
    width: '100%',
    height: 'auto',
    cursor: 'pointer',
    backgroundColor: '#FAFBF4',
  },
  playbackRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: '#FFFFFF',
    padding: '10px 16px',
    borderRadius: '16px',
    border: `1px solid #DDE3CE`,
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
  },
  playBtn: {
    backgroundColor: '#17713A',
    border: 'none',
    width: '36px',
    height: '36px',
    borderRadius: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  timelineSlider: {
    flex: 1,
    accentColor: '#17713A',
    cursor: 'pointer',
  },
  timeIndicator: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '13px',
    color: '#14301F',
    width: '70px',
    textAlign: 'center',
  },
  speedControl: {
    display: 'flex',
    alignItems: 'center',
  },
  speedSelect: {
    padding: '6px 10px',
    border: `1px solid #0D2015`,
    borderRadius: '8px',
    backgroundColor: '#FFFFFF',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    fontSize: '12px',
    color: '#14301F',
    cursor: 'pointer',
    outline: 'none',
  },
  clearBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    padding: '6px',
    cursor: 'pointer',
    color: '#4A6353',
    transition: 'color 0.2s',
  },
  dropdownSelect: {
    width: '100%',
    padding: '8px 12px',
    border: `1px solid #0D2015`,
    borderRadius: '8px',
    backgroundColor: '#FFFFFF',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    fontSize: '13px',
    color: '#14301F',
    outline: 'none',
    cursor: 'pointer',
  },
  floatingSavePanel: {
    position: 'absolute',
    bottom: '24px',
    right: '24px',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    padding: '16px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    zIndex: 30,
    width: '300px',
    border: `1px solid #0D2015`,
    borderRadius: '12px'
  },
};
