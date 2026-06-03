import { useState, Dispatch, SetStateAction } from 'react';
import { Alert, Platform, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { joinMatch, leaveMatch, addGuestParticipant, removeParticipantById, removeParticipantByName, updateParticipant } from '../../lib/services/participantService';
import { adjustJoinedPlayers, deleteMatchTransaction } from '../../lib/services/matchService';
import { sendEmailNotification, notifyPromotion } from '../../lib/services/notificationService';
import { createPayment, refundPayment } from '../../lib/services/paymentService';
import { supabase } from '../../lib/supabase';
import { Match, Participant, CancellationDeadline } from '../../lib/types';

interface MatchDataHook {
  match: Match | null;
  setMatch: Dispatch<SetStateAction<Match | null>>;
  participantsList: Participant[];
  setParticipantsList: Dispatch<SetStateAction<Participant[]>>;
  userId: string | null;
  myUserName: string;
  joined: boolean;
  setJoined: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  cancellationDeadline: CancellationDeadline | null;
  isFull: boolean;
  fetchData: () => Promise<void>;
}

export const useMatchActions = (matchDataHook: MatchDataHook, fromTable: (t: string) => string, prefix: string, env: string = 'prod', onMutate?: () => void) => {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    match, setMatch, participantsList, setParticipantsList,
    userId, myUserName, joined, setJoined, isAdmin,
    cancellationDeadline, isFull, fetchData
  } = matchDataHook;
  const id = match?.id ?? '';

  const [acting, setActing] = useState(false);

  // After an ACTIVE participant leaves, the DB trigger may have promoted the
  // oldest waitlisted player. Reconcile the local list (fetchData) and fire the
  // best-effort promotion emails. Only worth doing if a waitlist actually exists.
  const reconcilePromotion = async (removedWasActive: boolean) => {
    const hadWaitlist = participantsList.some((p) => p.waitlist);
    if (removedWasActive && hadWaitlist) {
      notifyPromotion(id);
      await fetchData();
    }
  };

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

        if (match?.requires_payment) {
          const confirmed = Platform.OS === 'web'
            ? window.confirm('¿Cancelar plaza? Se procesará un reembolso automático.')
            : await new Promise<boolean>((resolve) => {
                Alert.alert(
                  'Cancelar plaza',
                  '¿Seguro que quieres cancelar? Se procesará un reembolso automático.',
                  [{ text: 'No', style: 'cancel', onPress: () => resolve(false) },
                   { text: 'Sí, cancelar', style: 'destructive', onPress: () => resolve(true) }]
                );
              });
          if (!confirmed) { setActing(false); return; }

          const { data: pmt } = await supabase
            .from('payments')
            .select('id')
            .eq('match_id', id)
            .eq('user_id', userId)
            .eq('env', env === 'dev' ? 'dev' : 'prod')
            .eq('status', 'SUCCEEDED')
            .eq('is_guest', false)            // only THIS user's own spot, not their paid guests —
            .order('created_at', { ascending: false }) // otherwise multiple SUCCEEDED rows made
            .limit(1)                          // .maybeSingle() error and the cancel silently failed.
            .maybeSingle();

          if (pmt) {
            const result = await refundPayment(pmt.id);
            setJoined(false);
            const newCount = participantsList.length - 1;
            setParticipantsList((prev) => prev.filter((p) => p.user_id !== userId));
            sendEmailNotification(match!, 'leave', myUserName, newCount, id);
            onMutate?.();
            const msg = result.status === 'PENDING_REFUND_ADMIN'
              ? 'Plaza cancelada. El reembolso está pendiente de revisión por el administrador.'
              : 'Plaza cancelada. El reembolso se procesará en breve.';
            showAlert('Plaza cancelada', msg);
          } else {
            showAlert('Aviso', 'No se encontró un pago confirmado para esta plaza. Contacta con el organizador.');
          }
          setActing(false);
          return;
        }

        await leaveMatch(id, userId, fromTable);
        setJoined(false);
        const newCount = participantsList.length - 1;
        setParticipantsList((prev) => prev.filter((p) => p.user_id !== userId));
        sendEmailNotification(match!, 'leave', myUserName, newCount, id);
        await reconcilePromotion(true); // a regular user's own spot is always active
        onMutate?.();
      } else {
        const data = await joinMatch(id, userId, myUserName, fromTable);
        setJoined(true);
        const newCount = participantsList.length + 1;
        setParticipantsList((prev) => [...prev, data]);
        sendEmailNotification(match!, 'join', myUserName, newCount, id);
        onMutate?.();
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

    const guestCount = participantsList.filter((p) => !p.user_id && p.user_name && p.user_name.toLowerCase().includes('invitado')).length;
    const guestSuffix = guestCount > 0 ? ` (invitado ${guestCount + 1})` : ` (invitado)`;
    const guestName = `${myUserName}${guestSuffix}`;

    if (match?.requires_payment && match.price > 0) {
      const confirmed = Platform.OS === 'web'
        ? window.confirm(`¿Pagar plaza para ${guestName}? Se te cobrará €${Number(match.price).toFixed(2)}.`)
        : await new Promise<boolean>((resolve) => {
            Alert.alert(
              'Pagar plaza de invitado',
              `Se te cobrará €${Number(match.price).toFixed(2)} por la plaza de ${guestName}.`,
              [{ text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
               { text: 'Continuar', onPress: () => resolve(true) }]
            );
          });
      if (!confirmed) return;

      setActing(true);
      try {
        const { redirectUrl } = await createPayment(match!.id, env, guestName);
        if (Platform.OS === 'web') {
          window.location.href = redirectUrl;
        } else {
          await Linking.openURL(redirectUrl);
          setActing(false);
        }
      } catch (err: any) {
        showAlert('Error', err.message || 'No se pudo iniciar el pago');
        setActing(false);
      }
      return;
    }

    setActing(true);
    try {
      const data = await addGuestParticipant(id, guestName, fromTable);
      const newCount = participantsList.length + 1;
      setParticipantsList((prev) => [...prev, data]);
      sendEmailNotification(match!, 'join', guestName, newCount, id);
      onMutate?.();
      showAlert(t('common.success'), t('match_details.guest_added_success'));
    } catch (err: any) {
      showAlert('Error', err.message || 'No se pudo añadir al invitado.');
    }
    setActing(false);
  };

  const removeParticipant = async (p: Participant) => {
    setActing(true);
    try {
      if (p.id) {
        await removeParticipantById(p.id, fromTable);
      } else {
        await removeParticipantByName(id, p.user_name, fromTable);
      }
      setParticipantsList((prev) => prev.filter((item) => p.id ? item.id !== p.id : item.user_name !== p.user_name));
      if (p.user_id === userId) setJoined(false);
      sendEmailNotification(match!, 'leave', p.user_name, participantsList.length - 1, id);
      await reconcilePromotion(!p.waitlist); // removing an active player can free a slot
      onMutate?.();
    } catch(err) {
      showAlert('Error', 'No se pudo quitar al jugador.');
    }
    setActing(false);
  };

  const removeDummyPlayer = async () => {
    if (!match || acting) return;
    setActing(true);
    try {
      const newVal = await adjustJoinedPlayers(id, -1, env);
      setMatch({ ...match!, joined_players: newVal });
      onMutate?.(); // external-counter slots do not auto-promote (no row deleted)
    } catch(err) {
      showAlert('Error', 'No se pudo actualizar el contador.');
    }
    setActing(false);
  };

  // Admin field-management mutations (check-in / shirt color / paid). Optimistic
  // update with revert on failure. Only participants with a real id (not the
  // external "joined_players" counter) can be updated.
  const setParticipantField = async (p: Participant, patch: Partial<Participant>) => {
    if (!p.id) return;
    setParticipantsList((prev) => prev.map((it) => (it.id === p.id ? { ...it, ...patch } : it)));
    try {
      await updateParticipant(p.id, patch, fromTable);
    } catch (err: any) {
      setParticipantsList((prev) => prev.map((it) => (it.id === p.id ? p : it)));
      showAlert('Error', err?.message || 'No se pudo actualizar al jugador.');
    }
  };
  const setCheckin = (p: Participant, value: boolean) => setParticipantField(p, { checked_in: value });
  const setShirtColor = (p: Participant, color: 'white' | 'black' | null) => setParticipantField(p, { shirt_color: color });
  const setPaid = (p: Participant, value: boolean) => setParticipantField(p, { paid: value });

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

  const initiatePayment = async () => {
    if (!userId) {
      showAlert(t('match_details.login_required'), t('match_details.login_required_msg'));
      return;
    }
    setActing(true);
    try {
      const { redirectUrl } = await createPayment(match!.id, env);
      if (Platform.OS === 'web') {
        window.location.href = redirectUrl;
        // page navigates away — setActing not needed
      } else {
        await Linking.openURL(redirectUrl);
        setActing(false);
      }
    } catch (err: any) {
      showAlert('Error', err.message || 'No se pudo iniciar el pago');
      setActing(false);
    }
  };

  return { toggleJoin, addGuest, removeParticipant, removeDummyPlayer, setCheckin, setShirtColor, setPaid, executeDelete, acting, setActing, showAlert, initiatePayment };
};
