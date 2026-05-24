import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchAdminDirectory } from '../../lib/services/participantService';
import { addGuestParticipant } from '../../lib/services/participantService';
import { sendEmailNotification } from '../../lib/services/notificationService';
import { COLORS, FONTS } from '../../constants/theme';

export default function MatchAdminPanel({ match, isAdmin, isStarted, participantsList, setParticipantsList, executeDelete, fromTable, showAlert }: any) {
  const { t } = useTranslation();
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [adminDirectory, setAdminDirectory] = useState<any[]>([]);

  if (!isAdmin || !match) return null;

  const openDirectory = async () => {
    setShowAdminModal(true);
    try {
      const data = await fetchAdminDirectory(fromTable);
      setAdminDirectory(data || []);
    } catch (err) {
      showAlert('Error', 'No se pudo cargar el directorio.');
    }
  };

  const confirmAddManualPlayer = async (player: any) => {
    const baseName = player.name;
    const isMainUserAdded = participantsList.some((p: any) => p.user_name === baseName || p.user_name === `${baseName} (Directorio)`);
    
    let nameToUse = baseName;
    if (isMainUserAdded) {
      const guestCount = participantsList.filter((p: any) => p.user_name && p.user_name.toLowerCase().startsWith(`${baseName.toLowerCase()} (invitado`)).length;
      const guestSuffix = guestCount > 0 ? ` (invitado ${guestCount + 1})` : ` (invitado)`;
      nameToUse = `${baseName}${guestSuffix}`;
    }

    try {
      const data = await addGuestParticipant(match.id, nameToUse, fromTable);
      setParticipantsList((prev: any[]) => [...prev, data]);
      setShowAdminModal(false);
      sendEmailNotification(match, 'join', nameToUse, participantsList.length + 1, match.id);
      showAlert('Inscrito', `${nameToUse} añadido al partido.`);
    } catch (err) {
      showAlert('Error', 'No se pudo añadir al jugador.');
    }
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
              <TouchableOpacity onPress={() => setShowAdminModal(false)}>
                <Ionicons name="close" size={28} color={COLORS.TEXT_LIGHT} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={adminDirectory}
              keyExtractor={item => item.id.toString()}
              renderItem={({item}) => (
                <TouchableOpacity style={styles.dirPlayerCard} onPress={() => confirmAddManualPlayer(item)}>
                  <View style={styles.avatarSmall}><Text style={styles.avatarTextSmall}>{item.name.charAt(0)}</Text></View>
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
  modalBtnSecondary: { padding: 16, borderRadius: 12, backgroundColor: COLORS.BORDER, alignItems: 'center' },
  modalBtnSecondaryText: { color: COLORS.TEXT_MAIN, fontFamily: FONTS.BOLD, fontSize: 16 },
  modalBtnPrimary: { padding: 16, borderRadius: 12, backgroundColor: COLORS.PRIMARY, alignItems: 'center' },
  modalBtnPrimaryText: { color: '#FFF', fontFamily: FONTS.BOLD, fontSize: 16 }
});
