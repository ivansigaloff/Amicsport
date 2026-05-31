import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchAdminDirectory } from '../../lib/services/participantService';
import { addGuestParticipant } from '../../lib/services/participantService';
import { sendEmailNotification } from '../../lib/services/notificationService';
import { COLORS, FONTS, SHADOWS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';

export default function MatchAdminPanel({ match, isAdmin, isStarted, participantsList, setParticipantsList, executeDelete, fromTable, showAlert }: any) {
  const { t } = useTranslation();
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [adminDirectory, setAdminDirectory] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  if (!isAdmin || !match) return null;

  const openDirectory = async () => {
    setSearch('');
    setSelected(new Set());
    setShowAdminModal(true);
    try {
      const data = await fetchAdminDirectory(fromTable);
      setAdminDirectory(data || []);
    } catch (err) {
      showAlert('Error', 'No se pudo cargar el directorio.');
    }
  };

  const filteredDirectory = adminDirectory.filter((p: any) =>
    (p.name || '').toLowerCase().includes(search.trim().toLowerCase())
  );
  // Checked players float to the top of the list.
  const sortedDirectory = [...filteredDirectory].sort((a: any, b: any) => {
    const aSel = selected.has(a.id) ? 0 : 1;
    const bSel = selected.has(b.id) ? 0 : 1;
    return aSel !== bSel ? aSel - bSel : (a.name || '').localeCompare(b.name || '');
  });

  const closeDirectory = () => { setShowAdminModal(false); setSearch(''); setSelected(new Set()); };

  // Capacity: never let the admin select beyond the free spots (max - participants - external).
  const freeSpots = Math.max(0, (match.max_players || 0) - participantsList.length - (match.joined_players || 0));
  const canSelectMore = selected.size < freeSpots;

  // No directory match → create the player, add it to the directory and SELECT it,
  // keeping the modal open so the prior selections + the new one stay checked.
  const createAndSelect = async () => {
    const clean = search.trim();
    if (!clean || creating) return;
    if (!canSelectMore) { showAlert('Completo', 'No quedan plazas libres en este partido.'); return; }
    setCreating(true);
    try {
      const { data: created, error } = await supabase
        .from(fromTable('admin_players')).insert({ name: clean }).select().single();
      if (error || !created) throw error || new Error('no_data');
      setAdminDirectory((prev) => [...prev, created].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setSelected((prev) => new Set(prev).add(created.id));
      setSearch('');
    } catch (err) {
      showAlert('Error', 'No se pudo crear el jugador.');
    }
    setCreating(false);
  };

  // Dedup name vs the (running) participant list, mirroring confirmAddManualPlayer.
  const computeName = (baseName: string, list: any[]) => {
    const taken = list.some((p: any) => p.user_name === baseName || p.user_name === `${baseName} (Directorio)`);
    if (!taken) return baseName;
    const guestCount = list.filter((p: any) => p.user_name && p.user_name.toLowerCase().startsWith(`${baseName.toLowerCase()} (invitado`)).length;
    return `${baseName}${guestCount > 0 ? ` (invitado ${guestCount + 1})` : ' (invitado)'}`;
  };

  const toggleSelect = (id: string) => {
    const adding = !selected.has(id);
    if (adding && selected.size >= freeSpots) return; // no free spots left
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (adding) setSearch(''); // clear the search so the whole list (selected on top) shows again
  };

  // Inscribe all checked directory players in one go.
  const addSelected = async () => {
    const players = adminDirectory.filter((p: any) => selected.has(p.id));
    if (players.length === 0 || adding) return;
    setAdding(true);
    let working = [...participantsList];
    try {
      for (const player of players) {
        const name = computeName(player.name, working);
        const data = await addGuestParticipant(match.id, name, fromTable);
        working = [...working, data];
        sendEmailNotification(match, 'join', name, working.length, match.id);
      }
      setParticipantsList(working);
      closeDirectory();
      showAlert('Inscritos', `${players.length} jugador(es) añadido(s) al partido.`);
    } catch (err) {
      setParticipantsList(working); // keep whoever was added before the failure
      showAlert('Error', 'No se pudieron añadir todos los jugadores.');
    }
    setAdding(false);
  };

  return (
    <>
      <View style={[styles.section, styles.adminSection]}>
        <Text style={[styles.sectionTitle, { color: COLORS.TEXT_MAIN }]}>Panel de Administrador</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <TouchableOpacity 
            style={[styles.adminBtn, { backgroundColor: COLORS.PRIMARY }, isStarted && { backgroundColor: COLORS.BORDER, opacity: 0.5 }]} 
            onPress={openDirectory}
            disabled={isStarted}
          >
            <Ionicons name="person-add" size={18} color="#FFF" />
            <Text style={styles.adminBtnText}>{t('match_details.inscribe_agenda')}</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.adminBtn, { backgroundColor: COLORS.DANGER }]} 
            onPress={() => setShowDeleteConfirm(true)}
          >
            <Ionicons name="trash" size={18} color="#FFF" />
            <Text style={styles.adminBtnText}>{t('match_details.delete_match_title')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Directory Modal */}
      <Modal visible={showAdminModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('match_details.inscribe_modal_title')}</Text>
              <TouchableOpacity onPress={closeDirectory}>
                <Ionicons name="close" size={28} color={COLORS.TEXT_LIGHT} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={COLORS.TEXT_LIGHT} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder={t('match_details.search_player')}
                placeholderTextColor={COLORS.TEXT_LIGHT}
                autoCapitalize="words"
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={18} color={COLORS.TEXT_LIGHT} />
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.freeHint}>{freeSpots > 0 ? `${freeSpots} plaza(s) libre(s)` : 'Partido completo'}</Text>

            <FlatList
              data={sortedDirectory}
              keyExtractor={item => item.id.toString()}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 90 }}
              renderItem={({item}) => {
                const isSel = selected.has(item.id);
                const blocked = !isSel && !canSelectMore;
                return (
                  <TouchableOpacity style={[styles.dirPlayerCard, isSel && styles.dirPlayerCardSel, blocked && { opacity: 0.4 }]} onPress={() => toggleSelect(item.id)} disabled={blocked}>
                    <View style={styles.avatarSmall}><Text style={styles.avatarTextSmall}>{item.name.charAt(0)}</Text></View>
                    <Text style={styles.dirPlayerName}>{item.name}</Text>
                    <Ionicons name={isSel ? 'checkbox' : 'square-outline'} size={24} color={isSel ? COLORS.PRIMARY : COLORS.TEXT_LIGHT} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                search.trim().length > 0 ? (
                  <TouchableOpacity style={styles.dirPlayerCard} onPress={createAndSelect} disabled={creating || !canSelectMore}>
                    <View style={[styles.avatarSmall, { backgroundColor: COLORS.PRIMARY }]}>
                      <Ionicons name="add" size={18} color="#FFF" />
                    </View>
                    <Text style={styles.dirPlayerName} numberOfLines={1}>{t('match_details.create_player')}: «{search.trim()}»</Text>
                    <Ionicons name="person-add" size={24} color={COLORS.PRIMARY} />
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.emptyHint}>{t('match_details.no_directory_players')}</Text>
                )
              }
            />

            {selected.size > 0 && (
              <TouchableOpacity style={styles.fab} onPress={addSelected} disabled={adding} accessibilityRole="button">
                {adding ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="person-add" size={20} color="#FFF" />
                    <Text style={styles.fabText}>{t('match_details.add_selected', { count: selected.size })}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
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
              <TouchableOpacity style={[styles.modalBtnPrimary, { flex: 1, backgroundColor: COLORS.DANGER }]} onPress={() => { setShowDeleteConfirm(false); executeDelete(); }}>
                <Text style={styles.modalBtnPrimaryText}>{t('match_details.delete_now')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionTitle: { fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  adminSection: { backgroundColor: COLORS.WARNING_LIGHT, padding: 20, marginHorizontal: 20, borderRadius: 16, marginTop: 24 },
  adminBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 12, gap: 8 },
  adminBtnText: { color: '#FFF', fontFamily: FONTS.BOLD, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.BACKGROUND, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, height: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  modalBodyText: { fontSize: 16, color: COLORS.TEXT_MUTED, marginBottom: 24, lineHeight: 24 },
  dirPlayerCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.BORDER_LIGHT },
  avatarSmall: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.PRIMARY_LIGHT, justifyContent: 'center', alignItems: 'center' },
  avatarTextSmall: { fontSize: 14, fontFamily: FONTS.BOLD, color: COLORS.PRIMARY },
  dirPlayerName: { flex: 1, marginLeft: 12, fontSize: 16, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MAIN },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: COLORS.BORDER, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 16, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MAIN, padding: 0 },
  emptyHint: { textAlign: 'center', color: COLORS.TEXT_MUTED, fontFamily: FONTS.REGULAR, fontSize: 14, marginTop: 24 },
  dirPlayerCardSel: { backgroundColor: COLORS.WARNING_LIGHT },
  fab: { position: 'absolute', left: 24, right: 24, bottom: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.PRIMARY, paddingVertical: 16, borderRadius: 16, ...(SHADOWS.MEDIUM as any) },
  fabText: { color: '#FFF', fontFamily: FONTS.BOLD, fontSize: 16 },
  freeHint: { color: COLORS.TEXT_MUTED, fontFamily: FONTS.SEMI_BOLD, fontSize: 12, marginBottom: 8, marginLeft: 4 },
  modalBtnSecondary: { padding: 16, borderRadius: 12, backgroundColor: COLORS.BORDER, alignItems: 'center' },
  modalBtnSecondaryText: { color: COLORS.TEXT_MAIN, fontFamily: FONTS.BOLD, fontSize: 16 },
  modalBtnPrimary: { padding: 16, borderRadius: 12, backgroundColor: COLORS.PRIMARY, alignItems: 'center' },
  modalBtnPrimaryText: { color: '#FFF', fontFamily: FONTS.BOLD, fontSize: 16 }
});
