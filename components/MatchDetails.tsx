import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal, FlatList, Platform, Linking, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useEnv } from '../hooks/use-env';
import { shareMatch, copyMatchUrl } from '../lib/share';
import { parseMatchDate, formatLocalizedDate } from '../lib/date';
import i18n from '../lib/i18n';
import { COLORS, SHADOWS, FONTS, SIZES } from '../constants/theme';

export default function MatchDetails({ matchId, asComponent = false, onDeleteSuccess }: { matchId?: string, asComponent?: boolean, onDeleteSuccess?: () => void }) {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string }>();
  const id = matchId || params.id;
  const router = useRouter();
  const { fromTable, env } = useEnv();
  const prefix = env === 'dev' ? '/dev' : '';
  
  const [match, setMatch] = useState<any>(null);
  const [joined, setJoined] = useState(false);
  const [participantsList, setParticipantsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [myUserName, setMyUserName] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Admin Manual Join States
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminDirectory, setAdminDirectory] = useState<any[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);

  const { isStarted, isOver } = (() => {
    if (!match?.date || !match?.time) return { isStarted: false, isOver: false };
    const matchDateObj = parseMatchDate(match.date);
    const [h, m] = match.time.split(':').map(Number);
    const matchStartTime = new Date(matchDateObj);
    matchStartTime.setHours(h, m, 0, 0);
    
    const now = new Date();
    let bcnDate;
    try {
      const bcnStr = now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
      bcnDate = new Date(bcnStr);
    } catch (e) {
      bcnDate = now;
    }
    
    return {
      isStarted: bcnDate >= matchStartTime,
      isOver: bcnDate >= new Date(matchStartTime.getTime() + 2 * 60 * 60 * 1000)
    };
  })();

  const sendEmailNotification = async (type: 'join' | 'leave', playerName: string, currentParticipants?: number) => {
    if (!match?.creator_email) return;
    
    const count = currentParticipants ?? participantsList.length;
    const matchLink = `https://multigraf.info/Kickerzbcn/match/${id}`;

    try {
      const response = await fetch('https://multigraf.info/send_match_update.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: match.creator_email,
          type,
          playerName,
          matchTitle: match.title || match.venue,
          matchVenue: match.venue,
          matchDate: match.date,
          matchTime: match.time,
          playerCount: count,
          maxPlayers: match.max_players,
          matchLink
        })
      });
      const resData = await response.json();
      console.log('Notificación enviada:', resData);
      if (Platform.OS === 'web' && resData.status === 'ok') {
        // Opcional: mostrar un aviso discreto
        console.log('Correo enviado correctamente al administrador.');
      }
    } catch (e) {
      console.log('Error sending email notification:', e);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    // 1. Get Match
    const { data: mData } = await supabase.from(fromTable('matches')).select('*').eq('id', id).single();
    if (mData) {
      setMatch(mData);
    }
    
    // 2. Fetch Actual Real App Participants
    const { data: participants } = await supabase.from(fromTable('match_participants')).select('*').eq('match_id', id);
    const partsArray = participants || [];
    setParticipantsList(partsArray);
    
    // 3. Get User & check if joined
    const { data: authData } = await supabase.auth.getUser();
    if (authData?.user) {
      setUserId(authData.user.id);
      const meta = authData.user.user_metadata || {};
      const nameToSave = meta.full_name || meta.name || authData.user.email?.split('@')[0] || 'Jugador App';
      setMyUserName(nameToSave);
      const myJoinStatus = partsArray.some((p: any) => p.user_id === authData.user.id);
      setJoined(myJoinStatus);

      // Check Role
      const role = authData.user.user_metadata?.role;
      const isDevUser = authData.user.user_metadata?.is_dev === true;

      if (env === 'dev') {
        // En desarrollo, solo los que tengan rol 'admin' tienen permiso admin real
        setIsAdmin(role === 'admin');
      } else {
        // En producción, SOLO admins que NO sean dev tienen permiso
        setIsAdmin(role === 'admin' && !isDevUser);
      }
    }
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();
  }, [id, env]);

  const toggleJoin = async () => {
    if (!userId) {
      Alert.alert(t('match_details.login_required'), t('match_details.login_required_msg'));
      return;
    }
    setActing(true);
    
    try {
      if (joined) {
        // 12-hour cancellation policy
        const matchDateObj = parseMatchDate(match.date);
        const [h, m] = match.time.split(':').map(Number);
        const matchStartTime = new Date(matchDateObj);
        matchStartTime.setHours(h, m, 0, 0);
        
        const now = new Date();
        let bcnDate;
        try {
          const bcnStr = now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
          bcnDate = new Date(bcnStr);
        } catch (e) {
          bcnDate = now;
        }

        const diffMs = matchStartTime.getTime() - bcnDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        const limitHours = match.cancellation_hours || 12;

        if (diffHours < limitHours && !isAdmin) {
          setActing(false);
          const msg = `No puedes desapuntarte si faltan menos de ${limitHours} horas para el partido. Por favor, contacta con el administrador.`;
          if (Platform.OS === 'web') {
            window.alert(msg);
          } else {
            Alert.alert('Aviso', msg);
          }
          return;
        }

        // Leave
        const { error } = await supabase.from(fromTable('match_participants')).delete().eq('match_id', id).eq('user_id', userId);
        if (!error) {
          setJoined(false);
          const newCount = participantsList.length - 1;
          setParticipantsList(prev => prev.filter(p => p.user_id !== userId));
          sendEmailNotification('leave', myUserName, newCount);
        } else {
          Alert.alert('Error', error.message);
        }
      } else {
        // Join con info del nombre
        const { data, error } = await supabase.from(fromTable('match_participants')).insert({ 
          match_id: id, 
          user_id: userId,
          user_name: myUserName
        }).select().single();
        if (!error) {
           setJoined(true);
           const newCount = participantsList.length + 1;
           setParticipantsList(prev => [...prev, data]);
           sendEmailNotification('join', myUserName, newCount);
           Alert.alert(t('match_details.joined_msg'), t('match_details.joined_success'));
        } else {
           Alert.alert('Error', error.message);
        }
      }
    } catch(err) {
      Alert.alert('Fallo', 'Hubo un error de conexión');
    }
    
    setActing(false);
  };

  const addGuest = async () => {
    if (!userId) {
      Alert.alert(t('match_details.login_required'), t('match_details.login_required_guest_msg'));
      return;
    }
    if (isFull) {
      Alert.alert(t('match_details.reservation_limit'), t('match_details.reservation_limit_msg'));
      return;
    }
    
    setActing(true);
    const guestCount = participantsList.filter(p => !p.user_id && p.user_name && p.user_name.toLowerCase().includes('invitado')).length;
    const guestSuffix = guestCount > 0 ? ` (invitado ${guestCount + 1})` : ` (invitado)`;
    const guestName = `${myUserName}${guestSuffix}`;

    try {
      const { data, error } = await supabase.from(fromTable('match_participants')).insert({
        match_id: id,
        user_name: guestName
      }).select().single();

      if (!error) {
        const newCount = participantsList.length + 1;
        setParticipantsList(prev => [...prev, data]);
        sendEmailNotification('join', guestName, newCount);
        if (Platform.OS === 'web') window.alert(t('match_details.guest_added'));
        else Alert.alert(t('common.success'), t('match_details.guest_added_success'));
      } else {
        Alert.alert('Error', 'No se pudo añadir al invitado.');
      }
    } catch (err) {
      Alert.alert('Fallo', 'Error de conexión');
    }
    setActing(false);
  };

  const handleCancelSpot = async () => {
    setActing(true);
    const myGuests = participantsList.filter(p => !p.user_id && p.user_name && p.user_name.startsWith(`${myUserName} (invitado`));
    
    if (myGuests.length > 0) {
      const lastGuest = myGuests[myGuests.length - 1];
      await removeParticipant(lastGuest);
    } else {
      await toggleJoin();
    }
    setActing(false);
  };

  const openDirectory = async () => {
    setShowAdminModal(true);
    setLoadingDirectory(true);
    const { data } = await supabase.from(fromTable('admin_players')).select('*').order('name', { ascending: true });
    setAdminDirectory(data || []);
    setLoadingDirectory(false);
  };

  const confirmAddManualPlayer = async (player: any) => {
    const baseName = player.name;
    const isMainUserAdded = participantsList.some(p => p.user_name === baseName || p.user_name === `${baseName} (Directorio)`);
    
    const executeManualJoin = async (nameToUse: string) => {
      setActing(true);
      const { data, error } = await supabase.from(fromTable('match_participants')).insert({
        match_id: id,
        user_name: nameToUse
      }).select().single();

      if (!error) {
         setParticipantsList(prev => [...prev, data]);
         setShowAdminModal(false);
         if (Platform.OS === 'web') window.alert(`${nameToUse} añadido al partido.`);
         else Alert.alert('Inscrito', `${nameToUse} añadido al partido.`);
      } else {
         if (Platform.OS === 'web') window.alert('No se pudo añadir al jugador.');
         else Alert.alert('Error', 'No se pudo añadir al jugador.');
      }
      setActing(false);
    };

    if (isMainUserAdded) {
      const guestCount = participantsList.filter(p => p.user_name && p.user_name.toLowerCase().startsWith(`${baseName.toLowerCase()} (invitado`)).length;
      const guestSuffix = guestCount > 0 ? ` (invitado ${guestCount + 1})` : ` (invitado)`;
      
      // Añadir automáticamente como invitado sin popup (temporalmente deshabilitado)
      executeManualJoin(`${baseName}${guestSuffix}`);
    } else {
      // Primera vez: solo el nombre, sin (Directorio)
      executeManualJoin(`${baseName}`);
    }
  };

  const removeParticipant = async (p: any) => {
    setActing(true);
    let err;
    if (p.id) {
       const { error } = await supabase.from(fromTable('match_participants')).delete().eq('id', p.id);
       err = error;
    } else {
       // Fallback for safety
       const { error } = await supabase.from(fromTable('match_participants')).delete().eq('match_id', id).eq('user_name', p.user_name);
       err = error;
    }

    if (!err) {
       setParticipantsList(prev => prev.filter(item => {
         if (p.id && item.id) return item.id !== p.id;
         return item.user_name !== p.user_name;
       }));
       if (p.user_id === userId) {
         setJoined(false);
       }
       const newCount = participantsList.length - 1;
       sendEmailNotification('leave', p.user_name, newCount);
    } else {
       if (Platform.OS === 'web') window.alert('No se pudo quitar al jugador.');
       else Alert.alert('Error', 'No se pudo quitar al jugador.');
    }
    setActing(false);
  };

  const removeDummyPlayer = async () => {
    if (!match || acting) return;
    setActing(true);
    const newVal = Math.max(0, (match.joined_players || 0) - 1);
    const { error } = await supabase.from(fromTable('matches')).update({ joined_players: newVal }).eq('id', id);
    
    if (!error) {
       setMatch({ ...match, joined_players: newVal });
    } else {
       if (Platform.OS === 'web') window.alert('No se pudo actualizar el contador.');
       else Alert.alert('Error', 'No se pudo actualizar el contador.');
    }
    setActing(false);
  };

  const executeDelete = async () => {
    setActing(true);
    try {
      await supabase.from(fromTable('match_participants')).delete().eq('match_id', id);
      const { error } = await supabase.from(fromTable('matches')).delete().eq('id', id);
      if (error) throw error;
      
      if (Platform.OS === 'web') window.alert(t('match_details.delete_success'));
      else Alert.alert(t('common.delete'), t('match_details.delete_success'));
      
      if (asComponent && onDeleteSuccess) {
        onDeleteSuccess();
      } else if (!asComponent) {
        router.replace(`${prefix}/(tabs)` as any);
      }
    } catch (err: any) {
      if (Platform.OS === 'web') window.alert('Error: No se pudo eliminar el partido. Asegúrate de tener permisos.');
      else Alert.alert('Error', 'No se pudo eliminar el partido. Asegúrate de tener permisos.');
    }
    setActing(false);
  };

  const handleDeleteMatch = async () => {
    if (Platform.OS === 'web') {
      setShowDeleteConfirm(true);
    } else {
      Alert.alert(
        t('match_details.delete_match_title'),
        t('match_details.delete_match_msg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.delete'), style: 'destructive', onPress: executeDelete }
        ]
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.errorContainer}>
        {!asComponent && <Stack.Screen options={{ title: t('common.loading'), headerBackTitle: t('common.back'), headerTintColor: '#0F172A', headerStyle: { backgroundColor: '#FFFFFF' } }} />}
        <ActivityIndicator color="#FFB81C" />
      </View>
    );
  }
  
  if (!match) {
    return (
      <View style={styles.errorContainer}>
        {!asComponent && <Stack.Screen options={{ title: t('common.error'), headerBackTitle: t('common.back'), headerTintColor: '#0F172A', headerStyle: { backgroundColor: '#FFFFFF' } }} />}
        <Text style={styles.errorText}>{t('match_details.not_found')}</Text>
        {!asComponent && (
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
             <Text style={styles.backButtonText}>{t('common.back')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const availableSpots = match.max_players - (match.joined_players + participantsList.length);
  const isFull = availableSpots <= 0;
  
  const formattedDate = (() => {
    const d = parseMatchDate(match.date);
    const f = d ? formatLocalizedDate(d, i18n.language) : match.date;
    return f.charAt(0).toUpperCase() + f.slice(1);
  })();

  const cancellationDeadline = (() => {
    if (!match?.date || !match?.time) return null;
    const matchDateObj = parseMatchDate(match.date);
    const [h, m] = match.time.split(':').map(Number);
    const matchStartTime = new Date(matchDateObj);
    matchStartTime.setHours(h, m, 0, 0);
    
    const limitHours = match.cancellation_hours || 12;
    const deadline = new Date(matchStartTime.getTime() - (limitHours * 60 * 60 * 1000));
    
    const now = new Date();
    let bcnDate;
    try {
      const bcnStr = now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
      bcnDate = new Date(bcnStr);
    } catch (e) {
      bcnDate = now;
    }

    const isPast = bcnDate > deadline;
    const formattedDeadline = formatLocalizedDate(deadline, i18n.language);
    const timeStr = deadline.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
    
    return { date: formattedDeadline, time: timeStr, isPast };
  })();

  const renderContent = () => (
    <ScrollView 
      style={styles.scrollView} 
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={
        <RefreshControl 
          refreshing={refreshing} 
          onRefresh={onRefresh} 
          tintColor={COLORS.PRIMARY}
          colors={[COLORS.PRIMARY]}
        />
      }
    >
      {/* Header Image with Overlay */}
      <View style={styles.imageContainer}>
        <Image 
          source={{ uri: match.image_url || 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?q=80&w=2000&auto=format&fit=crop' }} 
          style={styles.headerImage} 
          contentFit="cover"
          transition={500}
          cachePolicy="memory-disk"
        />
        <View style={styles.imageOverlay} />
        
        {!asComponent && (
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color={COLORS.TEXT_WHITE} />
            </TouchableOpacity>
            
            <View style={styles.fullScreenHeaderRight}>
              <TouchableOpacity onPress={() => shareMatch(match)} style={styles.headerIconButtonRound}>
                <Ionicons name="share-outline" size={22} color={COLORS.TEXT_WHITE} />
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity 
                  onPress={() => router.push(`${prefix}/admin/crear-partido?editId=${id}` as any)} 
                  style={[styles.headerIconButtonRound, {backgroundColor: COLORS.PRIMARY}]}
                >
                  <Ionicons name="pencil" size={22} color={COLORS.TEXT_WHITE} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        
        <View style={styles.headerInfo}>
          <View style={styles.typeBadgeContainer}>
            {match.distance && match.distance !== 'Apto' && (
              <View style={[styles.typeBadge, {backgroundColor: '#38BDF8'}]}><Text style={styles.typeBadgeText}>{match.distance}</Text></View>
            )}
            {match.is_private && <View style={[styles.typeBadge, {backgroundColor: COLORS.SECONDARY}]}><Text style={styles.typeBadgeText}>{t('common.private')}</Text></View>}
            {match.is_female && <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{t('common.female')}</Text></View>}
            {match.is_mixed && <View style={[styles.typeBadge, {backgroundColor: COLORS.WARNING}]}><Text style={styles.typeBadgeText}>{t('common.mixed')}</Text></View>}
            {match.is_advanced && <View style={[styles.typeBadge, {backgroundColor: COLORS.DANGER}]}><Text style={styles.typeBadgeText}>{t('common.advanced')}</Text></View>}
          </View>
          <Text style={styles.mainTitle}>{match.title ? match.title : match.venue}</Text>
          <View style={styles.headerDateRow}>
            <Ionicons name="calendar" size={16} color={COLORS.PRIMARY_LIGHT} />
            <Text style={styles.headerDateText}>{formattedDate} • {match.time}</Text>
          </View>
        </View>
      </View>

      <View style={styles.content}>

        {/* Location Section */}
        <View style={styles.section}>
          <TouchableOpacity 
            style={[styles.venueCard, SHADOWS.SMALL]}
            onPress={() => Linking.openURL(match.location_url)}
          >
            <Ionicons name="map-outline" size={24} color={COLORS.PRIMARY} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.venueName}>{match.venue}</Text>
              <Text style={styles.venueAddress}>{t('match_details.distance_from_you')} 2.4 km</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.TEXT_LIGHT} />
          </TouchableOpacity>
        </View>

        {/* Participants Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('match_details.joined_list_title')}</Text>
            <View style={[styles.countBadge, { backgroundColor: isFull ? COLORS.DANGER : COLORS.SUCCESS }]}>
              <Text style={styles.countBadgeText}>{participantsList.length + (match.joined_players || 0)}/{match.max_players}</Text>
            </View>
          </View>

          <View style={styles.participantsContainer}>
            {participantsList.map((p, index) => (
              <View key={p.id || index} style={[styles.participantItem, SHADOWS.SMALL]}>
                <View style={styles.avatar}>
                   <Text style={styles.avatarText}>{p.user_name?.charAt(0).toUpperCase() || 'P'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.participantName}>{p.user_name}</Text>
                  <Text style={styles.participantStatus}>{p.user_id === userId ? t('match_details.self_joined') : t('match_details.confirmed_badge')}</Text>
                </View>
                {isAdmin && p.user_id !== userId && (
                  <TouchableOpacity 
                    onPress={() => removeParticipant(p)}
                    style={styles.removeBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={COLORS.DANGER} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {/* Dummy players */}
            {Array.from({ length: (match.joined_players || 0) }).map((_, i) => (
               <View key={`dummy-${i}`} style={[styles.participantItem, SHADOWS.SMALL, { opacity: 0.8 }]}>
                 <View style={[styles.avatar, { backgroundColor: COLORS.BORDER }]}>
                    <Ionicons name="person" size={20} color={COLORS.TEXT_LIGHT} />
                 </View>
                 <View style={{ flex: 1, marginLeft: 12 }}>
                   <Text style={[styles.participantName, { color: COLORS.TEXT_MUTED }]}>{t('match_details.external_player')}</Text>
                   <Text style={styles.participantStatus}>{t('match_details.verified_web')}</Text>
                 </View>
                 {isAdmin && (
                   <TouchableOpacity 
                     onPress={removeDummyPlayer}
                     style={styles.removeBtn}
                   >
                     <Ionicons name="close" size={18} color={COLORS.DANGER} />
                   </TouchableOpacity>
                 )}
               </View>
            ))}
          </View>
        </View>

        {/* Admin Specific Tools */}
        {isAdmin && (
          <View style={[styles.section, styles.adminSection]}>
            <Text style={[styles.sectionTitle, { color: COLORS.TEXT_MAIN }]}>Panel de Administrador</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <TouchableOpacity 
                style={[styles.adminBtn, { backgroundColor: COLORS.PRIMARY }, isStarted && { backgroundColor: COLORS.BORDER, opacity: 0.5 }]} 
                onPress={() => openDirectory()}
                disabled={isStarted}
              >
                <Ionicons name="person-add" size={18} color="#FFF" />
                <Text style={styles.adminBtnText}>{t('match_details.inscribe_agenda')}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.adminBtn, { backgroundColor: COLORS.DANGER }]} 
                onPress={() => handleDeleteMatch()}
              >
                <Ionicons name="trash" size={18} color="#FFF" />
                <Text style={styles.adminBtnText}>{t('match_details.delete_match_title')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container} edges={asComponent ? [] : ['top', 'left', 'right']}>
      {asComponent ? (
        <View style={{ flex: 1 }}>
           <View style={styles.componentHeaderTopBar}>
              <Text style={styles.componentHeaderTitle}>{match?.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity onPress={() => shareMatch(match)} style={styles.headerIconButton}>
                  <Ionicons name="share-outline" size={22} color={COLORS.TEXT_MUTED} />
                </TouchableOpacity>
                {isAdmin && (
                  <TouchableOpacity onPress={() => router.push(`${prefix}/admin/crear-partido?editId=${id}` as any)} style={styles.headerIconButton}>
                    <Ionicons name="pencil" size={22} color={COLORS.PRIMARY} />
                  </TouchableOpacity>
                )}
              </View>
           </View>
           {renderContent()}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <Stack.Screen options={{ headerShown: false }} />
          {renderContent()}
        </View>
      )}

      {/* Floating Action Bar */}
      <View style={[
        styles.actionBar, 
        SHADOWS.LARGE,
        { position: (Platform.OS === 'web' && !asComponent) ? 'fixed' : 'absolute' } as any
      ]}>
        <View>
          <Text style={styles.actionBarPrice}>{Number(match.price).toFixed(2)}€</Text>
          <Text style={styles.actionBarSubtitle}>{t('match_details.price_per_player')}</Text>
        </View>
        <View style={styles.joinActionArea}>
          {(() => {
            // Logic moved to component level for better scope visibility

            if (isStarted) {
              return (
                <View style={[styles.reserveBtn, { backgroundColor: COLORS.BORDER, opacity: 0.8 }]}>
                  <Ionicons name={isOver ? "checkbox-outline" : "time-outline"} size={20} color={COLORS.TEXT_LIGHT} />
                  <Text style={[styles.reserveBtnText, { color: COLORS.TEXT_LIGHT }]}>
                    {isOver 
                      ? (t('match_details.match_finished') || 'Partido finalizado') 
                      : (t('match_details.match_started') || 'Partido en curso')
                    }
                  </Text>
                </View>
              );
            }

            if (joined) {
              return (
                <View style={{ width: '100%', alignItems: 'flex-end' }}>
                  <View style={styles.actionRow}>
                    <TouchableOpacity 
                      style={[styles.smallIconBtn, { backgroundColor: COLORS.PRIMARY }]} 
                      onPress={addGuest}
                      disabled={acting || isFull}
                    >
                      <Ionicons name="person-add" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.reserveBtn, styles.joinedBtn]} 
                      onPress={handleCancelSpot}
                      disabled={acting}
                    >
                      {acting ? <ActivityIndicator color="#FFF" /> : (
                        <>
                          <Ionicons name="person-remove" size={24} color="#FFF" />
                          <Text style={[styles.reserveBtnText, { fontSize: 13 }]}>{t('match_details.cancel_spot')}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                  {cancellationDeadline && (
                    <Text style={[
                      styles.deadlineText, 
                      cancellationDeadline.isPast && { color: COLORS.DANGER }
                    ]}>
                      {cancellationDeadline.isPast 
                        ? 'Ya no puedes realizar cambios en este partido'
                        : `Puedes hacer cambios hasta el ${cancellationDeadline.date} a las ${cancellationDeadline.time}`
                      }
                    </Text>
                  )}
                </View>
              );
            }

            return (
              <TouchableOpacity 
                style={[
                  styles.reserveBtn, 
                  isFull && styles.fullBtn,
                  acting && { opacity: 0.7 }
                ]}
                onPress={toggleJoin}
                disabled={acting || isFull}
              >
                {acting ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="flash" size={28} color="#FFF" />
                    <Text style={styles.reserveBtnText}>
                      {isFull ? t('match_details.reservation_limit') : t('match_details.reserve_btn')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })()}
        </View>
      </View>

      {/* Directory Modal */}
      <Modal visible={showAdminModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('match_details.inscribe_modal_title')}</Text>
              <TouchableOpacity onPress={() => setShowAdminModal(false)}>
                <Ionicons name="close" size={28} color={COLORS.TEXT_LIGHT} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={adminDirectory}
              keyExtractor={item => item.id.toString()}
              renderItem={({item}) => (
                <TouchableOpacity 
                  style={styles.dirPlayerCard}
                  onPress={() => confirmAddManualPlayer(item)}
                >
                  <View style={styles.avatarSmall}>
                    <Text style={styles.avatarTextSmall}>{item.name.charAt(0)}</Text>
                  </View>
                  <Text style={styles.dirPlayerName}>{item.name}</Text>
                  <Ionicons name="add-circle" size={24} color={COLORS.PRIMARY} />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal visible={showDeleteConfirm} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: 'auto', paddingBottom: 40 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('match_details.confirm_delete')}</Text>
              <TouchableOpacity onPress={() => setShowDeleteConfirm(false)}>
                <Ionicons name="close" size={28} color={COLORS.TEXT_LIGHT} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalBodyText}>{t('match_details.delete_match_msg')}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={[styles.modalBtnSecondary, { flex: 1 }]} onPress={() => setShowDeleteConfirm(false)}>
                <Text style={styles.modalBtnSecondaryText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtnPrimary, { flex: 1, backgroundColor: COLORS.DANGER }]} onPress={executeDelete}>
                <Text style={styles.modalBtnPrimaryText}>{t('match_details.delete_now')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.BACKGROUND,
    ...(Platform.OS === 'web' ? { overscrollBehaviorY: 'contain' } : {}) as any 
  },
  scrollView: { flex: 1 },
  imageContainer: { width: '100%', height: 350, position: 'relative' },
  headerImage: { width: '100%', height: '100%' },
  imageOverlay: { 
    ...StyleSheet.absoluteFillObject, 
    backgroundColor: 'rgba(0,0,0,0.4)',
    // Gradiente sutil emulado con color sólido semitransparente
  },
  fullScreenHeader: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10
  },
  backButton: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    backgroundColor: 'rgba(15, 23, 42, 0.5)', 
    justifyContent: 'center', 
    alignItems: 'center', 
  },
  fullScreenHeaderRight: {
    flexDirection: 'row',
    gap: 12
  },
  headerIconButtonRound: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: { 
    position: 'absolute', 
    bottom: 40, 
    left: 20, 
    right: 20 
  },
  typeBadgeContainer: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  typeBadge: { 
    backgroundColor: COLORS.PRIMARY, 
    paddingHorizontal: 12, 
    paddingVertical: 4, 
    borderRadius: 20 
  },
  typeBadgeText: { color: COLORS.TEXT_WHITE, fontSize: 11, fontFamily: FONTS.BOLD },
  mainTitle: { 
    fontSize: 28, 
    fontFamily: FONTS.EXTRA_BOLD, 
    color: COLORS.TEXT_WHITE, 
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4
  },
  headerDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  headerDateText: { color: COLORS.TEXT_WHITE, fontSize: 14, fontFamily: FONTS.SEMI_BOLD },
  
  content: { 
    marginTop: -32, 
    backgroundColor: COLORS.BACKGROUND, 
    borderTopLeftRadius: 32, 
    borderTopRightRadius: 32, 
    padding: 20 
  },
  infoRow: { flexDirection: 'row', gap: 16, marginBottom: 24 },
  infoCard: { 
    flex: 1, 
    backgroundColor: COLORS.CARD_BG, 
    padding: 16, 
    borderRadius: 20, 
    alignItems: 'center',
    gap: 4
  },
  infoCardLabel: { color: COLORS.TEXT_LIGHT, fontSize: 10, fontFamily: FONTS.BOLD, textTransform: 'uppercase' },
  infoCardValue: { color: COLORS.TEXT_MAIN, fontSize: 14, fontFamily: FONTS.BOLD },
  
  section: { marginBottom: 24 },
  sectionHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  sectionTitle: { fontSize: 18, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  linkText: { color: COLORS.PRIMARY, fontFamily: FONTS.BOLD, fontSize: 14 },
  
  venueCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.CARD_BG, 
    padding: 16, 
    borderRadius: 0 
  },
  venueName: { fontSize: 16, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  venueAddress: { fontSize: 13, color: COLORS.TEXT_MUTED, fontFamily: FONTS.REGULAR, marginTop: 2 },
  
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 0 },
  countBadgeText: { color: COLORS.TEXT_WHITE, fontSize: 12, fontFamily: FONTS.BOLD },
  
  participantsContainer: { gap: 12 },
  participantItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.CARD_BG, 
    padding: 12, 
    borderRadius: 0, 
  },
  avatar: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    backgroundColor: COLORS.PRIMARY_LIGHT, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  avatarText: { color: COLORS.TEXT_WHITE, fontSize: 18, fontFamily: FONTS.BOLD },
  participantName: { fontSize: 15, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  participantStatus: { fontSize: 12, color: COLORS.TEXT_LIGHT, fontFamily: FONTS.MEDIUM },
  removeBtn: { padding: 8 },
  emptyText: { color: COLORS.TEXT_LIGHT, textAlign: 'center', marginVertical: 20, fontFamily: FONTS.MEDIUM },
  
  adminSection: { 
    padding: 16, 
    backgroundColor: '#EEF2FF', 
    borderRadius: 0, 
    borderWidth: 1, 
    borderColor: '#E0E7FF' 
  },
  adminBtn: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    padding: 14, 
    borderRadius: 16, 
    gap: 8 
  },
  adminBtnText: { color: COLORS.TEXT_WHITE, fontSize: 13, fontFamily: FONTS.BOLD },
  
  actionBar: { 
    zIndex: 1000,
    bottom: 0, 
    left: 0, 
    right: 0, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: COLORS.CARD_BG, 
    paddingHorizontal: 20,
    paddingVertical: 14, 
    borderRadius: 0,
    borderTopWidth: 1,
    borderTopColor: COLORS.BORDER_LIGHT
  },
  actionBarPrice: { fontSize: 24, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  actionBarSubtitle: { fontSize: 12, color: COLORS.TEXT_MUTED, fontFamily: FONTS.MEDIUM },
  reserveBtn: { 
    backgroundColor: COLORS.PRIMARY, 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 16, 
    height: 52, 
    borderRadius: 0, 
    gap: 6,
    flex: 1,
    justifyContent: 'center'
  },
  reserveBtnText: { color: COLORS.TEXT_WHITE, fontSize: 15, fontFamily: FONTS.BOLD },
  joinedBtn: { backgroundColor: COLORS.DANGER },
  fullBtn: { backgroundColor: COLORS.TEXT_LIGHT },
  actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flex: 1, justifyContent: 'flex-end' },
  smallIconBtn: { width: 52, height: 52, borderRadius: 0, justifyContent: 'center', alignItems: 'center' },
  joinActionArea: { flex: 1, alignItems: 'flex-end' },
  
  modalOverlay: { flex: 1, backgroundColor: COLORS.MODAL_OVERLAY, justifyContent: 'flex-end' },
  modalContent: { 
    backgroundColor: COLORS.CARD_BG, 
    borderTopLeftRadius: 32, 
    borderTopRightRadius: 32, 
    padding: 24, 
    maxHeight: '80%' 
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER_LIGHT
  },
  modalTitle: { fontSize: 20, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  dirPlayerCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    backgroundColor: COLORS.BACKGROUND, 
    borderRadius: 16, 
    marginBottom: 12,
    gap: 12
  },
  avatarSmall: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    backgroundColor: COLORS.PRIMARY_LIGHT, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  avatarTextSmall: { color: COLORS.TEXT_WHITE, fontSize: 14, fontFamily: FONTS.BOLD },
  dirPlayerName: { flex: 1, fontSize: 16, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  
  modalBodyText: { fontSize: 16, color: COLORS.TEXT_MUTED, lineHeight: 24, marginBottom: 32 },
  modalBtnPrimary: { 
    padding: 16, 
    borderRadius: 16, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  modalBtnPrimaryText: { color: COLORS.TEXT_WHITE, fontFamily: FONTS.BOLD, fontSize: 15 },
  modalBtnSecondary: { 
    padding: 16, 
    borderRadius: 16, 
    backgroundColor: COLORS.BORDER_LIGHT, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  modalBtnSecondaryText: { color: COLORS.TEXT_MUTED, fontFamily: FONTS.BOLD, fontSize: 15 },
  
  componentHeaderTopBar: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 20, 
    backgroundColor: COLORS.CARD_BG, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.BORDER_LIGHT 
  },
  componentHeaderTitle: { fontSize: 18, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  headerIconButton: { padding: 4 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: COLORS.TEXT_MUTED, fontFamily: FONTS.BOLD },
  backButton: { padding: 12, borderRadius: 12, backgroundColor: COLORS.PRIMARY, marginTop: 12 },
  backButtonText: { color: COLORS.TEXT_WHITE, fontFamily: FONTS.BOLD },
  deadlineText: { fontSize: 10, color: COLORS.TEXT_LIGHT, marginTop: 4, textAlign: 'right', fontStyle: 'italic' }
});

