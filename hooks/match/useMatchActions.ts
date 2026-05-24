import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { joinMatch, leaveMatch, addGuestParticipant, removeParticipantById, removeParticipantByName } from '../../lib/services/participantService';
import { fetchLatestMatchJoinedPlayers, updateMatchJoinedPlayers, deleteMatchTransaction } from '../../lib/services/matchService';
import { sendEmailNotification } from '../../lib/services/notificationService';

export const useMatchActions = (matchDataHook: any, fromTable: (t: string) => string, prefix: string) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { 
    match, setMatch, participantsList, setParticipantsList, 
    userId, myUserName, joined, setJoined, isAdmin, 
    cancellationDeadline, isFull 
  } = matchDataHook;
  const id = match?.id;

  const [acting, setActing] = useState(false);

  const showAlert = (title: string, msg: string) => {
    if (Platform.OS === 'web') window.alert(`${title ? title + ': ' : ''}${msg}`);
    else Alert.alert(title, msg);
  };

  const toggleJoin = async () => {
    if (!userId) {
      showAlert(t('match_details.login_required'), t('match_details.login_required_msg'));
      return;
    }
    setActing(true);
    try {
      if (joined) {
        if (cancellationDeadline?.isPast && !isAdmin) {
          showAlert('Aviso', `No puedes desapuntarte si faltan menos de ${cancellationDeadline.limitHours} horas para el partido.`);
          setActing(false);
          return;
        }
        await leaveMatch(id, userId, fromTable);
        setJoined(false);
        const newCount = participantsList.length - 1;
        setParticipantsList((prev: any[]) => prev.filter((p: any) => p.user_id !== userId));
        sendEmailNotification(match, 'leave', myUserName, newCount, id);
      } else {
        const data = await joinMatch(id, userId, myUserName, fromTable);
        setJoined(true);
        const newCount = participantsList.length + 1;
        setParticipantsList((prev: any[]) => [...prev, data]);
        sendEmailNotification(match, 'join', myUserName, newCount, id);
        showAlert(t('match_details.joined_msg'), t('match_details.joined_success'));
      }
    } catch(err: any) {
      showAlert('Fallo', err.message || 'Error de conexión');
    }
    setActing(false);
  };

  const addGuest = async () => {
    if (!userId) return showAlert(t('match_details.login_required'), t('match_details.login_required_guest_msg'));
    if (isFull) return showAlert(t('match_details.reservation_limit'), t('match_details.reservation_limit_msg'));
    
    setActing(true);
    const guestCount = participantsList.filter((p: any) => !p.user_id && p.user_name && p.user_name.toLowerCase().includes('invitado')).length;
    const guestSuffix = guestCount > 0 ? ` (invitado ${guestCount + 1})` : ` (invitado)`;
    const guestName = `${myUserName}${guestSuffix}`;

    try {
      const data = await addGuestParticipant(id, guestName, fromTable);
      const newCount = participantsList.length + 1;
      setParticipantsList((prev: any[]) => [...prev, data]);
      sendEmailNotification(match, 'join', guestName, newCount, id);
      showAlert(t('common.success'), t('match_details.guest_added_success'));
    } catch (err: any) {
      showAlert('Error', err.message || 'No se pudo añadir al invitado.');
    }
    setActing(false);
  };

  const removeParticipant = async (p: any) => {
    setActing(true);
    try {
      if (p.id) {
        await removeParticipantById(p.id, fromTable);
      } else {
        await removeParticipantByName(id, p.user_name, fromTable);
      }
      setParticipantsList((prev: any[]) => prev.filter((item: any) => p.id ? item.id !== p.id : item.user_name !== p.user_name));
      if (p.user_id === userId) setJoined(false);
      sendEmailNotification(match, 'leave', p.user_name, participantsList.length - 1, id);
    } catch(err) {
      showAlert('Error', 'No se pudo quitar al jugador.');
    }
    setActing(false);
  };

  const removeDummyPlayer = async () => {
    if (!match || acting) return;
    setActing(true);
    try {
      const currentVal = await fetchLatestMatchJoinedPlayers(id, fromTable);
      const newVal = Math.max(0, currentVal - 1);
      await updateMatchJoinedPlayers(id, newVal, fromTable);
      setMatch({ ...match, joined_players: newVal });
    } catch(err) {
      showAlert('Error', 'No se pudo actualizar el contador.');
    }
    setActing(false);
  };

  const executeDelete = async (asComponent?: boolean, onDeleteSuccess?: () => void) => {
    setActing(true);
    try {
      await deleteMatchTransaction(id, fromTable);
      showAlert(t('common.delete'), t('match_details.delete_success'));
      if (asComponent && onDeleteSuccess) onDeleteSuccess();
      else if (!asComponent) router.replace(`${prefix}/(tabs)` as any);
    } catch (err) {
      showAlert('Error', 'No se pudo eliminar el partido. Asegúrate de tener permisos.');
    }
    setActing(false);
  };

  return { toggleJoin, addGuest, removeParticipant, removeDummyPlayer, executeDelete, acting, setActing, showAlert };
};
