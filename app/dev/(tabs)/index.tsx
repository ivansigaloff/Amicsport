import { View, Text, StyleSheet, FlatList, SectionList, Image, TouchableOpacity, ActivityIndicator, RefreshControl, Switch, Alert, useWindowDimensions, Platform, Share, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { useEnv } from '../../../hooks/use-env';
import MatchDetails from '../../../components/MatchDetails';
import MapView from '../../../components/MapView';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { shareMultipleMatches, copyMultipleMatchUrls } from '../../../lib/share';

// Reusing same config as main
LocaleConfig.locales['es'] = {
  monthNames: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  monthNamesShort: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  dayNamesShort: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  today: 'Hoy'
};
LocaleConfig.defaultLocale = 'es';

const parseDateString = (dateStr: string) => {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const parts = dateStr.toLowerCase().replace('.', '').replace(',', '').split(' ');
  let dayStr, monthStr;
  
  if (parts.length >= 3) {
    dayStr = parts[1];
    monthStr = parts[2];
  } else if (parts.length === 2) {
    dayStr = parts[0];
    monthStr = parts[1];
  } else {
    return null;
  }
  
  const day = parseInt(dayStr, 10);
  const monthIdx = months.findIndex(m => monthStr.includes(m));
  
  if (monthIdx !== -1 && !isNaN(day)) {
    const d = new Date();
    d.setMonth(monthIdx);
    d.setDate(day);
    if (d < new Date(new Date().setMonth(new Date().getMonth() - 2))) {
       d.setFullYear(d.getFullYear() + 1);
    }
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }
  return null;
};

const addDaysToDateString = (dateStr: string, daysToAdd: number = 7) => {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const parts = dateStr.toLowerCase().replace('.', '').split(' ');
  if (parts.length >= 3) {
    const day = parseInt(parts[1], 10);
    const monthStr = parts[2];
    const monthIdx = months.findIndex(m => monthStr.includes(m));
    if (monthIdx !== -1 && !isNaN(day)) {
      const d = new Date();
      d.setMonth(monthIdx);
      d.setDate(day);
      if (d < new Date(new Date().setMonth(new Date().getMonth() - 2))) {
         d.setFullYear(d.getFullYear() + 1);
      }
      d.setDate(d.getDate() + daysToAdd);
      return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    }
  }
  return dateStr;
};

const MatchCard = ({ item, fetchMatches, onSelectMatch, isDesktop, isSelected, isAdmin, isShareMode, isShareSelected, onToggleShareSelect }: { item: any, fetchMatches: any, onSelectMatch: (id: string) => void, isDesktop: boolean, isSelected: boolean, isAdmin: boolean, isShareMode: boolean, isShareSelected: boolean, onToggleShareSelect: (id: string) => void }) => {
  const router = useRouter();
  const { fromTable, env } = useEnv();
  const [add7Days, setAdd7Days] = useState(true);
  const [duplicating, setDuplicating] = useState(false);
  
  const freeSlots = item.max_players - item.computed_joined;
  const freePct = (freeSlots / item.max_players) * 100;
  const isFull = freeSlots <= 0;

  const getStatusConfig = () => {
    if (isFull) return { text: 'COMPLETO', color: '#EF4444', bg: '#FEE2E2' };
    if (freePct <= 25) return { text: 'ABIERTO', color: '#F59E0B', bg: '#FEF3C7' };
    return { text: 'ABIERTO', color: '#10B981', bg: '#DCFCE7' };
  };

  const status = getStatusConfig();

  const handleDuplicate = async () => {
    setDuplicating(true);
    let newDate = item.date;
    if (add7Days) {
      newDate = addDaysToDateString(item.date, 7);
    }
    
    const { error } = await supabase.from(fromTable('matches')).insert({
      title: item.title,
      venue: item.venue,
      location_url: item.location_url,
      date: newDate,
      time: item.time,
      price: item.price,
      max_players: item.max_players,
      joined_players: 0,
      level: item.level,
      image_url: item.image_url,
      distance: item.distance,
      is_female: item.is_female,
      is_mixed: item.is_mixed,
      is_private: item.is_private,
      is_advanced: item.is_advanced
    });

    if (!error) {
       Alert.alert('Éxito', `Partido duplicado para el ${newDate}`);
       fetchMatches();
    } else {
       console.error('Error duplicating match (DEV):', error);
       Alert.alert('Error', `No se pudo duplicar el partido: ${error.message || 'Error desconocido'}`);
    }
    setDuplicating(false);
  };

  return (
    <View style={[styles.card, isSelected && isDesktop && styles.cardSelected, isShareSelected && styles.cardShareSelected]}>
      <TouchableOpacity 
        activeOpacity={0.8}
        onPress={() => {
          if (isShareMode) {
            onToggleShareSelect(item.id);
          } else if (isDesktop) {
            onSelectMatch(item.id);
          } else {
            const prefix = env === 'dev' ? '/dev' : '';
            router.push(`${prefix}/match/${item.id}` as any);
          }
        }}
        onLongPress={() => {
          if (!isShareMode) {
            onToggleShareSelect(item.id);
          }
        }}
      >
        {/* Image removed as requested */}
        
        
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <View style={[styles.tagsContainer, { marginTop: 2 }]}>
              {item.is_female && <Text style={styles.tagText}>Femenino</Text>}
              {item.is_mixed && <Text style={styles.tagText}>Mixto</Text>}
              {item.is_private && <Text style={styles.tagText}>Privado</Text>}
              {item.is_advanced && <Text style={styles.tagText}>Avanzado</Text>}
              
              {!item.is_female && !item.is_mixed && !item.is_private && !item.is_advanced && (
                <Text style={[styles.tagText, { backgroundColor: '#F1F5F9', color: '#94A3B8' }]}>Abierto</Text>
              )}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
            <View style={[styles.badge, { backgroundColor: status.bg }]}>
               <Text style={[styles.badgeText, { color: status.color }]}>
                 {item.computed_joined}/{item.max_players}
               </Text>
            </View>
            <TouchableOpacity 
              onPress={(e) => { e.stopPropagation && e.stopPropagation(); onToggleShareSelect(item.id); }}
              style={[styles.shareToggleBtn, isShareSelected && styles.shareToggleBtnActive]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name={isShareSelected ? 'checkbox' : 'square-outline'} size={20} color={isShareSelected ? '#FFFFFF' : '#94A3B8'} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="time-outline" size={18} color="#0F172A" />
            <Text style={styles.timeText}>{item.time}</Text>
          </View>
          <Text style={styles.priceText}>{Number(item.price).toFixed(2)}€</Text>
        </View>
      </TouchableOpacity>
      
      {isAdmin && (
        <View style={styles.duplicateContainer}>
          <View style={styles.duplicateSwitchRow}>
            <Text style={styles.duplicateLabel}>Copiar para +7 días</Text>
            <Switch 
              value={add7Days} 
              onValueChange={setAdd7Days} 
              trackColor={{ false: '#E2E8F0', true: '#556080' }} 
              thumbColor={'#FFF'} 
            />
          </View>
          <TouchableOpacity 
            style={[styles.duplicateButton, duplicating && { opacity: 0.5 }]} 
            onPress={handleDuplicate}
            disabled={duplicating}
          >
            {duplicating ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="copy-outline" size={16} color="#FFF" />
                <Text style={styles.duplicateButtonText}>Duplicar Partido</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default function MatchesScreenDev() {
  const router = useRouter();
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [selectedVenueFilter, setSelectedVenueFilter] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(true); 
  const { width } = useWindowDimensions();
  
  // Share mode state
  const [shareSelectedIds, setShareSelectedIds] = useState<Set<string>>(new Set());
  const isShareMode = shareSelectedIds.size > 0;

  // Expansion states
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [isMapExpanded, setIsMapExpanded] = useState(true);

  // Advanced Filters
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [filterFemale, setFilterFemale] = useState(false);
  const [filterMixed, setFilterMixed] = useState(false);
  const [filterPrivate, setFilterPrivate] = useState(false);
  const [filterAdvanced, setFilterAdvanced] = useState(false);
  const [filterMorning, setFilterMorning] = useState(false);
  const [filterEvening, setFilterEvening] = useState(false);

  const dayList = useMemo(() => {
    const days = [];
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push({
        dateString: d.toISOString().split('T')[0],
        dayNum: d.getDate().toString(),
        isToday: i === 0,
        label: d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
      });
    }
    return days;
  }, []);

  const horizontalListRef = useRef<FlatList>(null);
  const sectionListRef = useRef<SectionList>(null);
  const isSyncingFromClick = useRef(false);

  // Web Drag Scroll Logic
  const [isScrolling, setIsScrolling] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragScrollLeft, setDragScrollLeft] = useState(0);

  const onMouseDown = (e: any) => {
    if (Platform.OS !== 'web') return;
    const node = (horizontalListRef.current as any)?.getScrollableNode();
    if (!node) return;
    setIsScrolling(true);
    setDragStartX(e.pageX);
    setDragScrollLeft(node.scrollLeft);
  };

  const onMouseUp = () => setIsScrolling(false);
  const onMouseLeave = () => setIsScrolling(false);

  const onMouseMove = (e: any) => {
    if (!isScrolling || Platform.OS !== 'web') return;
    const node = (horizontalListRef.current as any)?.getScrollableNode();
    if (!node) return;
    e.preventDefault();
    const x = e.pageX;
    const walk = (x - dragStartX) * 1.5;
    node.scrollLeft = dragScrollLeft - walk;
  };

  const toggleShareSelect = (id: string) => {
    setShareSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cancelShareMode = () => setShareSelectedIds(new Set());

  const handleShareSelected = async () => {
    const selected = matches.filter(m => shareSelectedIds.has(m.id.toString()) || shareSelectedIds.has(m.id));
    if (selected.length === 0) return;
    await shareMultipleMatches(selected);
  };

  const handleCopySelected = async () => {
    const selected = matches.filter(m => shareSelectedIds.has(m.id.toString()) || shareSelectedIds.has(m.id));
    if (selected.length === 0) return;
    const ok = await copyMultipleMatchUrls(selected);
    if (Platform.OS === 'web') window.alert(ok ? 'Enlaces copiados al portapapeles' : 'No se pudo copiar');
    else Alert.alert(ok ? '✅ Copiado' : 'Error', ok ? `${selected.length} enlace${selected.length !== 1 ? 's' : ''} copiado${selected.length !== 1 ? 's' : ''} al portapapeles` : 'No se pudo copiar');
  };

  const handleBulkDelete = async () => {
    const selected = matches.filter(m => shareSelectedIds.has(m.id.toString()) || shareSelectedIds.has(m.id));
    if (selected.length === 0) return;
    const confirmMsg = `¿Seguro que quieres eliminar ${selected.length} partido${selected.length !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`;
    if (Platform.OS === 'web') {
      if (!window.confirm(confirmMsg)) return;
    } else {
      // On native, use Alert.alert with a promise pattern
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert('Eliminar Partidos', confirmMsg, [
          { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Eliminar', style: 'destructive', onPress: () => resolve(true) }
        ]);
      });
      if (!confirmed) return;
    }
    for (const m of selected) {
      await supabase.from(fromTable('match_participants')).delete().eq('match_id', m.id);
      await supabase.from(fromTable('matches')).delete().eq('id', m.id);
    }
    cancelShareMode();
    fetchMatches();
    if (Platform.OS === 'web') window.alert(`${selected.length} partido${selected.length !== 1 ? 's' : ''} eliminado${selected.length !== 1 ? 's' : ''}.`);
    else Alert.alert('Eliminados', `${selected.length} partido${selected.length !== 1 ? 's' : ''} eliminado${selected.length !== 1 ? 's' : ''}.`);
  };
  
  const { fromTable, env } = useEnv();
  
  const isDesktop = Platform.OS === 'web' && width > 1024;
  const isSmallScreen = width < 500;

  const fetchMatches = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    const { data, error } = await supabase
      .from(fromTable('matches'))
      .select(`*, ${fromTable('match_participants')}(count)`)
      .order('created_at', { ascending: false });

    if (data) {
      const processed = (data as any[])
        .filter(m => m && m.id)
        .map(m => {
          const devPartTable = fromTable('match_participants');
          const realCount = Array.isArray(m[devPartTable]) ? (m[devPartTable][0]?.count || 0) : 0;
          return {
            ...m,
            dateISO: parseDateString(m.date),
            computed_joined: (m.joined_players || 0) + realCount
          };
        });
      
      // Sort by date proximity (closest first)
      processed.sort((a, b) => {
        if (!a.dateISO) return 1;
        if (!b.dateISO) return -1;
        if (a.dateISO !== b.dateISO) return a.dateISO.localeCompare(b.dateISO);
        return (a.time || '').localeCompare(b.time || '');
      });

      setMatches(processed);
    }
    
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchMatches();
    checkRole();
    
    // Set initial filter to today as requested
    setSelectedDateFilter(todayISO);
  }, [env]);

  const checkRole = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error('Error getting user for role check (DEV):', error);
      setIsAdmin(false);
      return;
    }

    if (data?.user) {
      // SECURITY: read from app_metadata (server-only writes) with temporary
      // fallback to user_metadata for users not yet migrated. See lib/auth.ts.
      const role = data.user.app_metadata?.role ?? data.user.user_metadata?.role;
      const isDevUser =
        data.user.app_metadata?.is_dev === true ||
        data.user.user_metadata?.is_dev === true ||
        data.user.email === 'audit-test@amicsport.com';

      if (env === 'dev') {
        // En desarrollo, admins y perfiles is_dev tienen permiso
        setIsAdmin(role === 'admin' || isDevUser);
      } else {
        // En producción, SOLO admins que NO sean dev tienen permiso
        setIsAdmin(role === 'admin' && !isDevUser);
      }
    } else {
      setIsAdmin(false);
    }
  };

  const todayISO = new Date().toISOString().split('T')[0];
  const COLORS = { GREEN: '#10B981', YELLOW: '#F59E0B', RED: '#EF4444', INDIGO: '#556080' };

  const getAvailabilityColor = (mList: any[]) => {
    let bestPriority = 0;
    let bestColor = COLORS.INDIGO;
    mList.forEach(m => {
      const freeSlots = m.max_players - m.computed_joined;
      const freePct = (freeSlots / m.max_players) * 100;
      let color = COLORS.RED; let priority = 1;
      if (freePct > 25) { color = COLORS.GREEN; priority = 3; }
      else if (freePct > 0) { color = COLORS.YELLOW; priority = 2; }
      if (priority > bestPriority) { bestPriority = priority; bestColor = color; }
    });
    return bestColor;
  };

  const markedDates: any = {};
  const matchesByDateMap: Record<string, any[]> = {};
  matches.forEach(m => {
    if (m.dateISO && m.dateISO >= todayISO) {
      if (!matchesByDateMap[m.dateISO]) matchesByDateMap[m.dateISO] = [];
      matchesByDateMap[m.dateISO].push(m);
    }
  });

  const filteredMatches = matches.filter(m => {
    // 1. Venue Filter
    if (selectedVenueFilter && m.venue.trim().toLowerCase() !== selectedVenueFilter.trim().toLowerCase()) return false;

    // 2. Inclusive Category Filter (Female / Mixed)
    if (filterFemale || filterMixed) {
      const matchFemale = filterFemale && m.is_female;
      const matchMixed = filterMixed && m.is_mixed;
      if (!matchFemale && !matchMixed) return false;
    }

    // 3. Exclusive Category Filter (Private / Advanced)
    if (filterPrivate && !m.is_private) return false;
    if (filterAdvanced && !m.is_advanced) return false;

    // 4. Time Slot Filter
    if (m.time) {
      const hour = parseInt(m.time.split(':')[0], 10);
      if (filterMorning && filterEvening) {
        // Both selected: show all (no-op)
      } else if (filterMorning && hour >= 18) return false;
      else if (filterEvening && hour < 18) return false;
    }

    return true;
  });

  // Group matches into sections for SectionList
  const sections = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    filteredMatches.forEach(m => {
      if (m.dateISO) {
        if (!grouped[m.dateISO]) grouped[m.dateISO] = [];
        grouped[m.dateISO].push(m);
      }
    });
    
    return Object.keys(grouped).sort().map(dISO => {
      const isToday = dISO === new Date().toISOString().split('T')[0];
      const dObj = new Date(dISO + 'T00:00:00');
      const title = isToday ? 'Hoy' : dObj.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return {
        title,
        dateISO: dISO,
        data: grouped[dISO]
      };
    });
  }, [filteredMatches]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (isSyncingFromClick.current) return;
    if (viewableItems.length > 0) {
      const firstItem = viewableItems[0];
      if (firstItem.section) {
        const sectionDate = firstItem.section.dateISO;
        if (sectionDate && sectionDate !== selectedDateFilter) {
          setSelectedDateFilter(sectionDate);
        }
      }
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const handleDateSelect = (dateISO: string) => {
    isSyncingFromClick.current = true;
    setSelectedDateFilter(dateISO);
    setSelectedVenueFilter(null);
    const sIndex = sections.findIndex(s => s.dateISO === dateISO);
    if (sIndex !== -1) {
      sectionListRef.current?.scrollToLocation({
        sectionIndex: sIndex, itemIndex: 0, animated: true, viewOffset: 0
      });
    }
    setTimeout(() => { isSyncingFromClick.current = false; }, 1000);
  };

  useEffect(() => {
    if (!isCalendarExpanded && selectedDateFilter) {
      const index = dayList.findIndex(d => d.dateString === selectedDateFilter);
      if (index !== -1) {
        setTimeout(() => {
          horizontalListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        }, 100);
      }
    }
  }, [selectedDateFilter, isCalendarExpanded]);

  const handleSelectVenue = (venue: string | null) => {
    setSelectedVenueFilter(venue);
    if (venue) { setSelectedDateFilter(null); setSelectedMatchId(null); }
  };

  const clearAllFilters = () => {
    setSelectedDateFilter(null);
    setSelectedVenueFilter(null);
    setSelectedMatchId(null);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={isDesktop ? styles.desktopContainer : styles.container}>
        <View style={isDesktop ? styles.desktopListPanel : { flex: 1 }}>
          <View style={styles.header}>
            <Text style={styles.title}>Próximos Partidos (DEV)</Text>
            <TouchableOpacity onPress={() => fetchMatches(true)}>
              <Ionicons name="refresh-outline" size={24} color="#556080" />
            </TouchableOpacity>
          </View>

          {/* Sticky Horizontal Date Scroll */}
          {!isCalendarExpanded && (
            <View 
              style={styles.stickyDateContainer}
              // @ts-ignore - Web only handlers
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
              onMouseMove={onMouseMove}
            >
              <FlatList
                ref={horizontalListRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                data={dayList}
                keyExtractor={item => item.dateString}
                contentContainerStyle={styles.horizontalScrollContent}
                scrollEnabled={Platform.OS !== 'web' || !isScrolling}
                renderItem={({ item }) => {
                  const isSelected = selectedDateFilter === item.dateString;
                  const dayMatches = matchesByDateMap[item.dateString] || [];
                  const hasMatches = dayMatches.length > 0;
                  const availabilityColor = hasMatches ? getAvailabilityColor(dayMatches) : null;

                  return (
                    <TouchableOpacity 
                      style={[styles.dayBubble, isSelected && styles.dayBubbleSelected]}
                      onPress={() => handleDateSelect(item.dateString)}
                    >
                      <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>
                        {item.isToday ? 'Hoy' : item.dayNum}
                      </Text>
                      {availabilityColor && (
                        <View style={[styles.availabilityDot, { backgroundColor: isSelected ? '#FFFFFF' : availabilityColor }]} />
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListFooterComponent={
                  <TouchableOpacity onPress={() => setIsCalendarExpanded(true)} style={styles.expandInScroll}>
                    <Ionicons name="add-circle-outline" size={24} color="#556080" />
                  </TouchableOpacity>
                }
              />
            </View>
          )}

          {/* Full Calendar Overlay */}
          {isCalendarExpanded && (
            <View style={styles.calendarWrapper}>
              <View style={styles.sectionHeaderCompact}>
                <TouchableOpacity onPress={() => setIsCalendarExpanded(false)} style={styles.toggleBtn}>
                  <Ionicons name="remove-circle-outline" size={24} color="#556080" />
                </TouchableOpacity>
              </View>
              <Calendar
                theme={{
                  backgroundColor: '#FFFFFF', calendarBackground: '#FFFFFF',
                  textSectionTitleColor: '#64748B', selectedDayBackgroundColor: '#556080',
                  selectedDayTextColor: '#FFFFFF', todayTextColor: '#556080',
                  dayTextColor: '#0F172A', textDisabledColor: '#CBD5E1',
                  dotColor: '#556080', selectedDotColor: '#FFFFFF',
                  arrowColor: '#556080', monthTextColor: '#0F172A',
                  indicatorColor: '#556080', textDayFontWeight: '500',
                  textMonthFontWeight: '700', textDayHeaderFontWeight: '600'
                }}
                markingType={'custom'}
                markedDates={markedDates}
                current={selectedDateFilter || undefined}
                onDayPress={(day: any) => {
                  handleDateSelect(day.dateString);
                  setIsCalendarExpanded(false);
                }}
              />
              {(selectedDateFilter || selectedVenueFilter) && (
                <TouchableOpacity style={styles.clearFilterButton} onPress={clearAllFilters}>
                  <Text style={styles.clearFilterText}>Mostrar Todos los Partidos</Text>
                  <Ionicons name="close-circle" size={16} color="#556080" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {loading && !refreshing ? (
            <ActivityIndicator size="large" color="#556080" style={{ marginTop: 50 }} />
          ) : (
            <SectionList
              ref={sectionListRef}
              sections={sections}
              keyExtractor={(item, index) => item?.id?.toString() || `match-${index}`}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section: { title } }) => (
                <View style={styles.dateSeparator}>
                  <Text style={styles.dateSeparatorText}>{title}</Text>
                </View>
              )}
              renderItem={({ item }) => (
                <MatchCard item={item} fetchMatches={fetchMatches} isDesktop={isDesktop} onSelectMatch={setSelectedMatchId} isSelected={selectedMatchId === item.id} isAdmin={isAdmin} isShareMode={isShareMode} isShareSelected={shareSelectedIds.has(item.id.toString()) || shareSelectedIds.has(item.id)} onToggleShareSelect={toggleShareSelect} />
              )}
              ListHeaderComponent={
                <View>
                  {!isDesktop && (
                    <View style={{ marginTop: 0 }}>
                      <View style={[styles.sectionHeaderCompact, { marginBottom: 4 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <TouchableOpacity onPress={() => setIsFilterModalVisible(true)} style={{ marginRight: 12 }}>
                            <Ionicons name="options-outline" size={24} color={ (filterFemale || filterMixed || filterPrivate || filterAdvanced || filterMorning || filterEvening) ? '#10B981' : '#556080' } />
                          </TouchableOpacity>
                          <Text style={styles.sectionTitleSmall}>Mapa de Recintos</Text>
                        </View>
                        <TouchableOpacity onPress={() => setIsMapExpanded(!isMapExpanded)} style={styles.toggleBtn}>
                          <Ionicons name={isMapExpanded ? 'remove-circle-outline' : 'add-circle-outline'} size={24} color="#556080" />
                        </TouchableOpacity>
                      </View>
                      {isMapExpanded && (
                        <View style={styles.mobileMapWrapper}>
                          <MapView matches={filteredMatches} selectedVenue={selectedVenueFilter} selectedMatchId={selectedMatchId} onSelectVenue={handleSelectVenue} />
                        </View>
                      )}
                    </View>
                  )}

                  {isAdmin && (
                    <View style={styles.adminActionsContainer}>
                      <TouchableOpacity style={styles.adminActionBtn} onPress={() => router.push('/dev/admin/crear-partido' as any)}>
                        <Ionicons name="add-circle-outline" size={18} color="#556080" />
                        <Text style={styles.adminActionText}>Crear Partido</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.adminActionBtn, { marginLeft: 12 }]} onPress={() => router.push('/dev/admin/jugadores' as any)}>
                        <Ionicons name="people-outline" size={18} color="#556080" />
                        <Text style={styles.adminActionText}>Agenda Jugadores</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              }
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchMatches(true)} tintColor="#556080" progressBackgroundColor="#FFFFFF" colors={['#556080']} />}
            />
          )}
        </View>

        {isDesktop && (
          <View style={styles.desktopDetailsPanel}>
            {selectedMatchId ? (
              <MatchDetails matchId={selectedMatchId} asComponent={true} onDeleteSuccess={() => { setSelectedMatchId(null); fetchMatches(); }} />
            ) : (
              <View style={styles.emptyDetails}>
                <Ionicons name="football-outline" size={64} color="#556080" />
                <Text style={styles.emptyDetailsText}>Selecciona un partido</Text>
              </View>
            )}
          </View>
        )}

        {isDesktop && (
          <View style={styles.desktopMapPanel}>
            <MapView
              matches={matchesByDateMap}
              selectedVenue={selectedVenueFilter}
              selectedMatchId={selectedMatchId}
              onSelectVenue={handleSelectVenue}
            />
          </View>
        )}
      </View>

      {/* Floating Share Action Bar */}
      {isShareMode && (
        <View style={styles.shareBar}>
          <TouchableOpacity onPress={cancelShareMode} style={styles.shareBarCancel}>
            <Ionicons name="close" size={20} color="#64748B" />
          </TouchableOpacity>
          <Text style={styles.shareBarText}>{shareSelectedIds.size} seleccionado{shareSelectedIds.size !== 1 ? 's' : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={handleCopySelected} style={[styles.shareBarBtn, isSmallScreen && { paddingHorizontal: 12 }]}>
              <Ionicons name="link-outline" size={18} color="#FFF" />
              {!isSmallScreen && <Text style={styles.shareBarBtnText}>Copiar Link</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShareSelected} style={[styles.shareBarBtn, { backgroundColor: '#10B981' }, isSmallScreen && { paddingHorizontal: 12 }]}>
              <Ionicons name="share-outline" size={18} color="#FFF" />
              {!isSmallScreen && <Text style={styles.shareBarBtnText}>Compartir</Text>}
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity onPress={handleBulkDelete} style={[styles.shareBarBtn, { backgroundColor: '#EF4444' }, isSmallScreen && { paddingHorizontal: 12 }]}>
                <Ionicons name="trash-outline" size={18} color="#FFF" />
                {!isSmallScreen && <Text style={styles.shareBarBtnText}>Eliminar</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      {/* Advanced Filter Modal */}
      <Modal visible={isFilterModalVisible} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: 'auto', paddingBottom: 40 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filtrar Partidos</Text>
              <TouchableOpacity onPress={() => setIsFilterModalVisible(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView>
              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="female" size={20} color="#556080" />
                  <Text style={styles.filterLabelText}>Femenino</Text>
                </View>
                <Switch value={filterFemale} onValueChange={setFilterFemale} trackColor={{ false: '#E2E8F0', true: '#556080' }} />
              </View>

              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="male-female" size={20} color="#556080" />
                  <Text style={styles.filterLabelText}>Mixto</Text>
                </View>
                <Switch value={filterMixed} onValueChange={setFilterMixed} trackColor={{ false: '#E2E8F0', true: '#556080' }} />
              </View>

              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="lock-closed" size={20} color="#556080" />
                  <Text style={styles.filterLabelText}>Privado</Text>
                </View>
                <Switch value={filterPrivate} onValueChange={setFilterPrivate} trackColor={{ false: '#E2E8F0', true: '#556080' }} />
              </View>

              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="trophy" size={20} color="#556080" />
                  <Text style={styles.filterLabelText}>Avanzado</Text>
                </View>
                <Switch value={filterAdvanced} onValueChange={setFilterAdvanced} trackColor={{ false: '#E2E8F0', true: '#556080' }} />
              </View>

              <Text style={[styles.label, { marginTop: 20 }]}>Franja Horaria</Text>
              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="sunny-outline" size={20} color="#556080" />
                  <Text style={styles.filterLabelText}>Mañana (00:00 - 18:00)</Text>
                </View>
                <Switch value={filterMorning} onValueChange={setFilterMorning} trackColor={{ false: '#E2E8F0', true: '#556080' }} />
              </View>

              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="moon-outline" size={20} color="#556080" />
                  <Text style={styles.filterLabelText}>Tarde (18:00 - 00:00)</Text>
                </View>
                <Switch value={filterEvening} onValueChange={setFilterEvening} trackColor={{ false: '#E2E8F0', true: '#556080' }} />
              </View>

              <TouchableOpacity 
                style={[styles.applyButton, { marginTop: 30 }]}
                onPress={() => setIsFilterModalVisible(false)}
              >
                <Text style={styles.applyButtonText}>VER PARTIDOS</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={{ marginTop: 15, alignItems: 'center' }}
                onPress={() => {
                  setFilterFemale(false);
                  setFilterMixed(false);
                  setFilterPrivate(false);
                  setFilterAdvanced(false);
                  setFilterMorning(false);
                  setFilterEvening(false);
                }}
              >
                <Text style={{ color: '#64748B', fontWeight: '600' }}>Limpiar filtros</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 20, marginTop: 40 },
  title: { fontSize: 28, fontWeight: '800', color: '#0F172A' },
  listContent: { paddingBottom: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, marginBottom: 12, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, borderWidth: 1, borderColor: '#F1F5F9' },
  cardImage: { width: '100%', height: 160 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, paddingBottom: 2 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  badge: { backgroundColor: '#F1F5F9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeFull: { backgroundColor: '#FEE2E2' },
  badgeText: { color: '#556080', fontSize: 11, fontWeight: '700' },
  badgeTextFull: { color: '#EF4444' },
  detailsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  detailsText: { color: '#64748B', marginLeft: 8, fontSize: 14, fontWeight: '500' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#F1F5F9', marginTop: 0 },
  playersContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  tagsContainer: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tagIcon: { marginRight: 2 },
  tagText: { color: '#556080', fontSize: 12, fontWeight: '700', backgroundColor: '#EDF2F7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  playersText: { color: '#556080', marginLeft: 6, fontWeight: '700' },
  timeText: { color: '#0F172A', fontSize: 22, fontWeight: '800', marginLeft: 8 },
  priceText: { color: '#64748B', fontSize: 18, fontWeight: '400' },
  adminActionsContainer: { flexDirection: 'row', paddingBottom: 20, paddingTop: 5 },
  adminActionBtn: { flex: 1, backgroundColor: '#F1F5F9', padding: 12, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E0E7FF' },
  adminActionText: { color: '#556080', marginLeft: 8, fontWeight: '700', fontSize: 14 },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  filterLabelCol: { flexDirection: 'row', alignItems: 'center' },
  filterLabelText: { fontSize: 16, color: '#0F172A', fontWeight: '600', marginLeft: 12 },
  applyButton: { backgroundColor: '#556080', padding: 18, borderRadius: 16, alignItems: 'center', shadowColor: '#556080', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  applyButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  duplicateContainer: { backgroundColor: '#F8FAFC', padding: 16, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  duplicateSwitchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  duplicateLabel: { color: '#64748B', fontSize: 13, fontWeight: '700' },
  duplicateButton: { backgroundColor: '#556080', padding: 14, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', shadowColor: '#556080', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  duplicateButtonText: { color: '#FFFFFF', fontWeight: '800', marginLeft: 8, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  label: { fontSize: 13, fontWeight: '800', color: '#64748B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  desktopContainer: { flex: 1, flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 16, backgroundColor: '#F8FAFC' },
  desktopListPanel: { width: 380, borderRightWidth: 1, borderRightColor: '#E2E8F0', paddingRight: 20, height: '100%', flexShrink: 0 },
  desktopDetailsPanel: { flex: 1.5, borderRightWidth: 1, borderRightColor: '#E2E8F0', paddingHorizontal: 20, height: '100%' },
  desktopMapPanel: { flex: 1, paddingLeft: 20, height: '100%' },
  mobileMapWrapper: { height: 280, marginBottom: 20, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  emptyDetails: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 24, marginVertical: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  emptyDetailsText: { color: '#94A3B8', fontSize: 16, marginTop: 16, fontWeight: '600' },
  cardSelected: { borderColor: '#556080', borderWidth: 2, shadowOpacity: 0.15, shadowRadius: 12 },
  calendarWrapper: { marginBottom: 20, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12 },
  clearFilterButton: { backgroundColor: '#556080', paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  clearFilterText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  cardShareSelected: { borderColor: '#10B981', borderWidth: 2, backgroundColor: '#F0FDF4' },
  shareCheckbox: { position: 'absolute', top: 12, right: 12, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 6, padding: 2 },
  shareBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#E2E8F0', elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10 },
  shareBarCancel: { padding: 8, backgroundColor: '#F1F5F9', borderRadius: 20 },
  shareBarText: { color: '#0F172A', fontWeight: '800', fontSize: 15 },
  shareBarBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#556080', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  shareBarBtnText: { color: '#FFFFFF', fontWeight: '700', marginLeft: 6, fontSize: 13 },
  shareToggleBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
  shareToggleBtnActive: { backgroundColor: '#556080', borderColor: '#556080' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 4 },
  sectionHeaderCompact: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 0, paddingHorizontal: 4 },
  sectionTitleSmall: { fontSize: 16, fontWeight: '700', color: '#64748B' },
  toggleBtn: { padding: 4 },
  horizontalScrollContainer: { 
    marginBottom: 20,
    backgroundColor: '#FFFFFF', 
    borderRadius: 20, 
    paddingVertical: 10, 
    borderWidth: 1, 
    borderColor: '#F1F5F9',
    // @ts-ignore
    cursor: Platform.OS === 'web' ? 'grab' : 'default',
    userSelect: 'none'
  },
  stickyDateContainer: {
    backgroundColor: '#F8FAFC',
    paddingVertical: 10,
    zIndex: 100,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    // @ts-ignore
    cursor: Platform.OS === 'web' ? 'grab' : 'default',
    userSelect: 'none'
  },
  horizontalScrollContent: { paddingHorizontal: 10, alignItems: 'center' },
  dayBubble: { width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF', marginRight: 10, borderWidth: 1, borderColor: '#F1F5F9', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
  dayBubbleSelected: { backgroundColor: '#556080', borderColor: '#556080' },
  expandInScroll: { width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F5F9', marginLeft: 5 },
  dateSeparator: { paddingVertical: 12, paddingHorizontal: 4, backgroundColor: '#F8FAFC' },
  dateSeparatorText: { fontSize: 16, fontWeight: '800', color: '#1E293B', textTransform: 'capitalize' },
  dayText: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  dayTextSelected: { color: '#FFFFFF' },
  availabilityDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 }
});
