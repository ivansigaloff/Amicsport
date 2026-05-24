import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useEnv } from '../hooks/use-env';
import { shareMatch } from '../lib/share';
import { COLORS, FONTS } from '../constants/theme';

import { useMatch } from '../hooks/match/useMatch';
import { useMatchActions } from '../hooks/match/useMatchActions';

import MatchHeader from './match/MatchHeader';
import MatchLocationCard from './match/MatchLocationCard';
import MatchParticipantsList from './match/MatchParticipantsList';
import MatchAdminPanel from './match/MatchAdminPanel';
import MatchActionBar from './match/MatchActionBar';

export default function MatchDetails({ matchId, asComponent = false, onDeleteSuccess }: { matchId?: string, asComponent?: boolean, onDeleteSuccess?: () => void }) {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string }>();
  const id = matchId || params.id;
  const router = useRouter();
  const { fromTable, env } = useEnv();
  const prefix = env === 'dev' ? '/dev' : '';

  const [refreshing, setRefreshing] = useState(false);

  const matchDataHook = useMatch(id, env, fromTable);
  const { match, loading, fetchData, participantsList, isFull, isAdmin, userId, isStarted, isOver, cancellationDeadline, formattedDate, joined } = matchDataHook;
  
  const actionsHook = useMatchActions(matchDataHook, fromTable, prefix);
  const { toggleJoin, addGuest, removeParticipant, removeDummyPlayer, executeDelete, acting, showAlert } = actionsHook;

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handleCancelSpot = async () => {
    actionsHook.setActing(true);
    const myGuests = participantsList.filter((p: any) => !p.user_id && p.user_name && p.user_name.startsWith(`${matchDataHook.myUserName} (invitado`));
    
    if (myGuests.length > 0) {
      const lastGuest = myGuests[myGuests.length - 1];
      await removeParticipant(lastGuest);
    } else {
      await toggleJoin();
    }
    actionsHook.setActing(false);
  };

  if (loading && !refreshing) {
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

  const renderContent = () => (
    <ScrollView 
      style={styles.scrollView} 
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.PRIMARY} colors={[COLORS.PRIMARY]} />
      }
    >
      <MatchHeader match={match} formattedDate={formattedDate} asComponent={asComponent} router={router} isAdmin={isAdmin} prefix={prefix} id={id} />
      <View style={styles.content}>
        <MatchLocationCard match={match} />
        <MatchParticipantsList match={match} participantsList={participantsList} isFull={isFull} isAdmin={isAdmin} userId={userId} removeParticipant={removeParticipant} removeDummyPlayer={removeDummyPlayer} />
        <MatchAdminPanel match={match} isAdmin={isAdmin} isStarted={isStarted} participantsList={participantsList} setParticipantsList={matchDataHook.setParticipantsList} executeDelete={() => executeDelete(asComponent, onDeleteSuccess)} fromTable={fromTable} showAlert={showAlert} />
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

      <MatchActionBar match={match} isStarted={isStarted} isOver={isOver} joined={joined} acting={acting} isFull={isFull} toggleJoin={toggleJoin} addGuest={addGuest} handleCancelSpot={handleCancelSpot} cancellationDeadline={cancellationDeadline} asComponent={asComponent} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.BACKGROUND, ...(Platform.OS === 'web' ? { overscrollBehaviorY: 'contain' } : {}) as any },
  scrollView: { flex: 1 },
  content: { paddingBottom: 20 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: COLORS.TEXT_MUTED, fontFamily: FONTS.BOLD },
  backButton: { padding: 12, borderRadius: 12, backgroundColor: COLORS.PRIMARY, marginTop: 12 },
  backButtonText: { color: COLORS.TEXT_WHITE, fontFamily: FONTS.BOLD },
  componentHeaderTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: COLORS.CARD_BG, borderBottomWidth: 1, borderBottomColor: COLORS.BORDER_LIGHT },
  componentHeaderTitle: { fontSize: 18, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  headerIconButton: { padding: 4 }
});
