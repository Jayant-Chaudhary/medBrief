import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:quick_actions/quick_actions.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/app_theme.dart';
import '../auth/auth_controller.dart';
import '../checkin/checkin_page.dart';
import '../checkin/guided_checkin_page.dart';
import '../checkin/checkin_repository.dart';
import '../checkin/ad_hoc_concern_sheet.dart';
import '../checkin/quick_pulse_sheet.dart';
import '../community/community_page.dart';
import '../community/community_push.dart';
import '../community/community_repository.dart';
import '../consult_audio/consult_audio_controller.dart';
import '../consult_audio/consult_audio_page.dart';
import '../consult_audio/consult_audio_repository.dart';
import '../profile/profile_controller.dart';
import '../profile/profile_page.dart';
import '../profile/profile_repository.dart';
import '../reports/report_controller.dart';
import '../reports/report_repository.dart';
import '../reports/reports_page.dart';
import '../summary/summary_controller.dart';
import '../summary/summary_page.dart';
import 'appointment_repository.dart';
import 'appointments_tab.dart';
import '../notifications/notification_config.dart';
import '../notifications/patient_notification_service.dart';
import 'home_controller.dart';
import 'home_tab.dart';

/// The authenticated shell of the patient app.
///
/// Hosts the 4 primary patient destinations:
///   0: Home (Dashboard & quick vitals)
///   1: Appointments (Visits list with card-level Check-in & View Summary)
///   2: Reports (Lab reports library & OCR)
///   3: Community (Peer discussion forum & private care inbox)
///
/// Profile is directly accessible from the top-right avatar menu.
class HomePage extends StatefulWidget {
  const HomePage({
    super.key,
    required this.auth,
    this.api,
    this.push,
    this.repository,
    this.checkinRepository,
    this.reportRepository,
    this.summaryRepository,
    this.profileRepository,
    this.notificationService,
  });

  final AuthController auth;
  final ApiClient? api;
  final CommunityPush? push;
  final PatientNotificationService? notificationService;
  final AppointmentRepository? repository;
  final CheckinRepository? checkinRepository;
  final ReportRepository? reportRepository;
  final SummaryRepository? summaryRepository;
  final ProfileRepository? profileRepository;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  late final HomeController _homeController;
  late final ReportController _reportController;
  late final SummaryController _summaryController;
  late final ProfileController _profileController;
  int _tabIndex = 0;
  bool _communityInboxRequested = false;
  final _communityNavigator = GlobalKey<NavigatorState>();
  ConsultAudioController? _consultController;

  @override
  void initState() {
    super.initState();
    final repo = widget.repository ?? AppointmentRepository(api: widget.api);
    _homeController = HomeController(
      repo: repo,
      profile: widget.auth.profile!,
      checkinRepo: widget.checkinRepository ?? CheckinRepository(api: widget.api),
      notificationService: widget.notificationService,
    );
    _homeController.load();

    _reportController = ReportController(
      repo: widget.reportRepository ?? ReportRepository(api: widget.api),
    );

    _summaryController = SummaryController(
      repo: widget.summaryRepository ?? SummaryRepository(api: widget.api),
    );

    _profileController = ProfileController(
      repo: widget.profileRepository ?? ProfileRepository(api: widget.api),
    );

    widget.push?.inboxRequests.addListener(_handleInboxRequest);
    widget.notificationService?.onNotificationTapped = _handleNotificationPayload;
    _initQuickActions();
  }

  void _initQuickActions() {
    try {
      const quickActions = QuickActions();
      quickActions.initialize((String type) {
        if (!mounted) return;
        switch (type) {
          case 'action_checkin':
            _openGuidedCheckin();
            break;
          case 'action_consultation':
            _openConsultation();
            break;
          case 'action_emergency':
            _showEmergencyContactsSheet();
            break;
        }
      });
      quickActions.setShortcutItems(const <ShortcutItem>[
        ShortcutItem(
          type: 'action_checkin',
          localizedTitle: 'Weekly Check-in',
          icon: 'ic_shortcut_checkin',
        ),
        ShortcutItem(
          type: 'action_consultation',
          localizedTitle: 'Join Consultation',
          icon: 'ic_shortcut_consultation',
        ),
        ShortcutItem(
          type: 'action_emergency',
          localizedTitle: 'Emergency Contacts',
          icon: 'ic_shortcut_emergency',
        ),
      ]);
    } catch (_) {
      /* Supported on device runtime; harmless in unit tests */
    }
  }

  void _showEmergencyContactsSheet() {
    HapticFeedback.mediumImpact();
    final profile = widget.auth.profile;
    final emergencyPhone = profile?.emergencyContactPhone?.trim();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: line,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Center(
                      child: Icon(
                        Icons.emergency_outlined,
                        color: Color(0xFFDC2626),
                        size: 26,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Emergency & Care Contacts',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: ink,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Immediate clinical guidance & triage',
                          style: TextStyle(fontSize: 12, color: muted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFBEB),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.warning_amber_rounded, color: Color(0xFFD97706), size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Seek emergency care immediately if you experience severe abdominal pain, persistent bleeding, reduced fetal movements, or severe headaches with vision changes.',
                        style: TextStyle(
                          fontSize: 12,
                          color: Color(0xFF92400E),
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              if (emergencyPhone != null && emergencyPhone.isNotEmpty) ...[
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const CircleAvatar(
                    backgroundColor: Color(0xFFEDF5F4),
                    child: Icon(Icons.person, color: primary),
                  ),
                  title: const Text(
                    'Personal Emergency Contact',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: ink),
                  ),
                  subtitle: Text(
                    emergencyPhone,
                    style: const TextStyle(fontSize: 13, color: muted),
                  ),
                  trailing: FilledButton.icon(
                    onPressed: () => launchUrl(Uri.parse('tel:$emergencyPhone')),
                    icon: const Icon(Icons.call, size: 16),
                    label: const Text('Call'),
                    style: FilledButton.styleFrom(
                      backgroundColor: primary,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      minimumSize: const Size(0, 40),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const Divider(height: 20, color: line),
              ] else ...[
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const CircleAvatar(
                    backgroundColor: Color(0xFFF9F7F4),
                    child: Icon(Icons.person_add_outlined, color: muted),
                  ),
                  title: const Text('No Emergency Contact saved'),
                  subtitle: const Text('Add in your profile for 1-tap dialling'),
                  trailing: TextButton(
                    onPressed: () {
                      Navigator.of(sheetContext).pop();
                      _handleNavigate('/profile');
                    },
                    child: const Text('Add →'),
                  ),
                ),
                const Divider(height: 20, color: line),
              ],
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFFEE2E2),
                  child: Icon(Icons.local_hospital_outlined, color: Color(0xFFDC2626)),
                ),
                title: const Text(
                  'Emergency Medical Services',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: ink),
                ),
                subtitle: const Text(
                  'National Emergency Helpline',
                  style: TextStyle(fontSize: 13, color: muted),
                ),
                trailing: FilledButton.icon(
                  onPressed: () => launchUrl(Uri.parse('tel:112')),
                  icon: const Icon(Icons.phone_in_talk, size: 16),
                  label: const Text('112'),
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFDC2626),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    minimumSize: const Size(0, 40),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
  void _handleNotificationPayload(String payload) {
    if (!mounted) return;
    if (payload == NotificationConfig.payloadAppointments) {
      setState(() => _tabIndex = 1);
      widget.notificationService?.cancelAppointmentReminder();
    } else if (payload == NotificationConfig.payloadCheckin) {
      _openGuidedCheckin();
      widget.notificationService?.cancelCheckinReminder();
    } else if (payload == NotificationConfig.payloadQuickPulse) {
      _openQuickPulse();
      widget.notificationService?.cancelCheckinReminder();
    }
  }

  void _handleInboxRequest() {
    if (mounted && widget.api != null) {
      _openCommunity(inbox: true);
    }
  }

  void _openCommunity({bool inbox = false}) {
    if (widget.api == null) return;
    setState(() {
      _tabIndex = 3;
      _communityInboxRequested = inbox;
    });
  }

  void _openGuidedCheckin({Appointment? appointment}) {
    final checkinRepo =
        widget.checkinRepository ?? CheckinRepository(api: widget.api);
    final profile = widget.auth.profile;

    int? gestationalWeek;
    if (profile?.dueDate != null) {
      final due = DateTime.tryParse(profile!.dueDate!);
      if (due != null) {
        final diffDays = due.difference(DateTime.now()).inDays;
        final week = 40 - (diffDays / 7).round();
        if (week >= 1 && week <= 42) {
          gestationalWeek = week;
        }
      }
    }

    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => GuidedCheckinPage(
          appointmentId: appointment?.id,
          gestationalWeek: gestationalWeek,
          repository: checkinRepo,
          emergencyContactPhone: profile?.emergencyContactPhone,
          onCompleted: () {
            Navigator.of(context).pop();
            widget.notificationService?.cancelCheckinReminder();
            _homeController.refresh();
          },
          onCancel: () => Navigator.of(context).pop(),
        ),
      ),
    );
  }

  void _openQuickPulse() {
    final checkinRepo =
        widget.checkinRepository ?? CheckinRepository(api: widget.api);
    final profile = widget.auth.profile;

    int? gestationalWeek;
    if (profile?.dueDate != null) {
      final due = DateTime.tryParse(profile!.dueDate!);
      if (due != null) {
        final diffDays = due.difference(DateTime.now()).inDays;
        final week = 40 - (diffDays / 7).round();
        if (week >= 1 && week <= 42) gestationalWeek = week;
      }
    }

    QuickPulseSheet.show(
      context,
      repository: checkinRepo,
      gestationalWeek: gestationalWeek,
      onSubmitted: () => _homeController.refresh(),
    );
  }

  void _openAdHocConcern() {
    final checkinRepo =
        widget.checkinRepository ?? CheckinRepository(api: widget.api);
    final profile = widget.auth.profile;

    int? gestationalWeek;
    if (profile?.dueDate != null) {
      final due = DateTime.tryParse(profile!.dueDate!);
      if (due != null) {
        final diffDays = due.difference(DateTime.now()).inDays;
        final week = 40 - (diffDays / 7).round();
        if (week >= 1 && week <= 42) gestationalWeek = week;
      }
    }

    AdHocConcernSheet.show(
      context,
      repository: checkinRepo,
      gestationalWeek: gestationalWeek,
      onSubmitted: () => _homeController.refresh(),
    );
  }

  void _openCheckin(Appointment appointment) {
    _homeController.selectAppointment(appointment.id);
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => CheckinPage(
          appointment: appointment,
          repository:
              widget.checkinRepository ?? CheckinRepository(api: widget.api),
          onFinished: () {
            Navigator.of(context).pop();
            widget.notificationService?.cancelCheckinReminder();
            _homeController.refresh();
          },
          onCancel: () => Navigator.of(context).pop(),
        ),
      ),
    );
  }

  void _openSummary({Appointment? appointment}) {
    final targetId =
        appointment?.id ?? _homeController.appointments.past.firstOrNull?.id;
    if (targetId != null) {
      _summaryController.selectAppointment(targetId);
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          backgroundColor: const Color(0xFFFBF8F5),
          appBar: AppBar(
            backgroundColor: const Color(0xFFFBF8F5),
            elevation: 0,
            scrolledUnderElevation: 1,
            leading: const BackButton(color: ink),
            title: const Text(
              'Visit Summary',
              style: TextStyle(
                color: ink,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          body: SummaryPage(
            controller: _summaryController,
            completedAppointments: _homeController.appointments.past,
            initialAppointmentId: targetId,
          ),
        ),
      ),
    );
  }

  void _openProfile() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          backgroundColor: const Color(0xFFFBF8F5),
          appBar: AppBar(
            backgroundColor: const Color(0xFFFBF8F5),
            elevation: 0,
            scrolledUnderElevation: 1,
            leading: const BackButton(color: ink),
            title: const Text(
              'Profile & Contacts',
              style: TextStyle(
                color: ink,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          body: ProfilePage(
            controller: _profileController,
            homeController: _homeController,
            appointmentRepository:
                widget.repository ?? AppointmentRepository(api: widget.api),
            onSignOut: widget.auth.signOut,
          ),
        ),
      ),
    );
  }

  Future<void> _openConsultation() async {
    if (widget.api == null) return;
    if (_consultController?.stage == PatientConsultStage.completed) {
      _consultController!.dispose();
      _consultController = null;
    }
    final firstOpen = _consultController == null;
    final controller = _consultController ??= ConsultAudioController(
      repository: ConsultAudioRepository(api: widget.api!),
      ownerId: widget.auth.profile!.id,
    );
    if (firstOpen) {
      try {
        await controller.restoreActive();
      } catch (_) {
        controller.setStage(PatientConsultStage.error);
      }
    }
    // Every open: drop a remembered room the doctor closed or replaced.
    await controller.refreshRoom();
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ConsultAudioPage(
          controller: controller,
          onFinished: () => _homeController.refresh(),
        ),
      ),
    );
  }

  @override
  void dispose() {
    widget.push?.inboxRequests.removeListener(_handleInboxRequest);
    _homeController.dispose();
    _reportController.dispose();
    _summaryController.dispose();
    _profileController.dispose();
    _consultController?.dispose();
    super.dispose();
  }

  void _handleNavigate(String route) {
    if (route == '/appointments') {
      setState(() => _tabIndex = 1);
    } else if (route == '/reports') {
      setState(() => _tabIndex = 2);
    } else if (route == '/community') {
      _openCommunity();
    } else if (route == '/consult' || route == '/consultation') {
      _openConsultation();
    } else if (route == '/checkin') {
      final appt =
          _homeController.activeAppointment ??
          _homeController.appointments.upcoming.firstOrNull;
      if (appt != null) {
        _openCheckin(appt);
      } else {
        setState(() => _tabIndex = 1);
      }
    } else if (route == '/summary') {
      final past = _homeController.appointments.past.firstOrNull;
      _openSummary(appointment: past);
    } else if (route == '/profile') {
      _openProfile();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('$route coming in the next update!'),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFBF8F5),
      appBar: _tabIndex == 3 ? null : _buildAppBar(),
      body: ListenableBuilder(
        listenable: _homeController,
        builder: (context, _) => _buildTab(),
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: const Color(0xFFFBF8F5),
      elevation: 0,
      scrolledUnderElevation: 1,
      shadowColor: line.withValues(alpha: 0.5),
      titleSpacing: 20,
      title: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            padding: const EdgeInsets.all(5),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: line),
            ),
            child: Image.asset(
              'assets/logo-mark.png',
              excludeFromSemantics: true,
            ),
          ),
          const SizedBox(width: 10),
          const Text(
            'MedBrief',
            style: TextStyle(
              color: primary,
              fontSize: 19,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
      actions: [

        ListenableBuilder(
          listenable: widget.auth,
          builder: (context, _) => PopupMenuButton<String>(
            tooltip: 'Account',
            icon: CircleAvatar(
              radius: 18,
              backgroundColor: primary,
              child: Text(
                (widget.auth.profile?.fullName.isNotEmpty == true
                        ? widget.auth.profile!.fullName[0]
                        : '?')
                    .toUpperCase(),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                ),
              ),
            ),
            itemBuilder: (_) => [
              PopupMenuItem(
                enabled: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.auth.profile?.fullName ?? '',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        color: ink,
                      ),
                    ),
                    const Text(
                      'Patient account',
                      style: TextStyle(fontSize: 12, color: muted),
                    ),
                  ],
                ),
              ),
              const PopupMenuDivider(),
              if (widget.api != null)
                const PopupMenuItem(
                  value: 'consultation',
                  child: Row(
                    children: [
                      Icon(Icons.meeting_room_outlined, size: 18, color: ink),
                      SizedBox(width: 10),
                      Text('Join Consultation'),
                    ],
                  ),
                ),
              if (widget.api != null)
                const PopupMenuItem(
                  value: 'community',
                  child: Row(
                    children: [
                      Icon(Icons.forum_outlined, size: 18, color: ink),
                      SizedBox(width: 10),
                      Text('Community'),
                    ],
                  ),
                ),
              const PopupMenuItem(
                value: 'profile',
                child: Row(
                  children: [
                    Icon(Icons.person_outline_rounded, size: 18, color: ink),
                    SizedBox(width: 10),
                    Text('Profile'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: 'signout',
                child: Row(
                  children: [
                    Icon(Icons.logout_rounded, size: 18, color: ink),
                    SizedBox(width: 10),
                    Text('Sign out'),
                  ],
                ),
              ),
            ],
            onSelected: (value) {
              if (value == 'signout') {
                widget.auth.signOut();
              } else if (value == 'profile') {
                _openProfile();
              } else if (value == 'community') {
                _openCommunity();
              } else if (value == 'consultation') {
                _openConsultation();
              }
            },
          ),
        ),
        const SizedBox(width: 8),
      ],
    );
  }

  Widget _buildTab() {
    switch (_tabIndex) {
      case 0:
        return HomeTab(
          controller: _homeController,
          onNavigate: _handleNavigate,
          onCheckin: _openCheckin,
          onPeriodicCheckin: () => _openGuidedCheckin(),
          onQuickPulse: _openQuickPulse,
          onLogConcern: _openAdHocConcern,
          onViewSummary: (appt) => _openSummary(appointment: appt),
          onSignOut: widget.auth.signOut,
        );
      case 1:
        return AppointmentsTab(
          controller: _homeController,
          onNavigate: _handleNavigate,
          onCheckin: _openCheckin,
          onPeriodicCheckin: () => _openGuidedCheckin(),
          onViewSummary: (appt) => _openSummary(appointment: appt),
          onSignOut: widget.auth.signOut,
        );
      case 2:
        return ReportsPage(
          controller: _reportController,
          appointments: _homeController.appointments.upcoming,
          activeAppointment: _homeController.activeAppointment,
          onSelectAppointment: (appt) =>
              _homeController.selectAppointment(appt.id),
        );
      case 3:
        if (widget.api == null) {
          return const Center(
            child: Text('Connect to the clinic to open Community.'),
          );
        }
        // Keep community dialogs inside this subtree so account changes dispose them.
        return NavigatorPopHandler<void>(
          onPopWithResult: (_) => _communityNavigator.currentState?.maybePop(),
          child: Navigator(
            key: _communityNavigator,
            onGenerateRoute: (_) => MaterialPageRoute<void>(
              builder: (_) => CommunityPage(
                repository: CommunityRepository(widget.api!),
                push: widget.push,
                initialInbox: _communityInboxRequested,
                onExit: () => setState(() => _tabIndex = 0),
              ),
            ),
          ),
        );
      default:
        return Center(child: Text('Tab $_tabIndex'));
    }
  }

  Widget _buildBottomNav() {
    return NavigationBar(
      selectedIndex: _tabIndex,
      onDestinationSelected: (i) => setState(() {
        _tabIndex = i;
        _communityInboxRequested = false;
        if (i == 1) {
          widget.notificationService?.cancelAppointmentReminder();
        }
      }),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w500,
        ),
      ),
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      shadowColor: line.withValues(alpha: 0.4),
      elevation: 4,
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home_rounded),
          label: 'Home',
        ),
        NavigationDestination(
          icon: Icon(Icons.calendar_month_outlined),
          selectedIcon: Icon(Icons.calendar_month_rounded),
          label: 'Appointments',
        ),
        NavigationDestination(
          icon: Icon(Icons.description_outlined),
          selectedIcon: Icon(Icons.description_rounded),
          label: 'Reports',
        ),
        NavigationDestination(
          icon: Icon(Icons.forum_outlined),
          selectedIcon: Icon(Icons.forum_rounded),
          label: 'Community',
        ),
      ],
    );
  }
}
