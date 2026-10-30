import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/app_theme.dart';
import '../auth/auth_controller.dart';
import '../checkin/checkin_page.dart';
import '../checkin/checkin_repository.dart';
import '../community/community_page.dart';
import '../community/community_push.dart';
import '../community/community_repository.dart';
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
  });

  final AuthController auth;
  final ApiClient? api;
  final CommunityPush? push;
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

  @override
  void initState() {
    super.initState();
    final repo = widget.repository ?? AppointmentRepository(api: widget.api);
    _homeController = HomeController(repo: repo, profile: widget.auth.profile!);
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
            _homeController.refresh();
          },
          onCancel: () => Navigator.of(context).pop(),
        ),
      ),
    );
  }

  void _openSummary({Appointment? appointment}) {
    final targetId = appointment?.id ??
        _homeController.appointments.past.firstOrNull?.id;
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

  @override
  void dispose() {
    widget.push?.inboxRequests.removeListener(_handleInboxRequest);
    _homeController.dispose();
    _reportController.dispose();
    _summaryController.dispose();
    _profileController.dispose();
    super.dispose();
  }

  void _handleNavigate(String route) {
    if (route == '/appointments') {
      setState(() => _tabIndex = 1);
    } else if (route == '/reports') {
      setState(() => _tabIndex = 2);
    } else if (route == '/community') {
      _openCommunity();
    } else if (route == '/checkin') {
      final appt = _homeController.activeAppointment ??
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
          onViewSummary: (appt) => _openSummary(appointment: appt),
          onSignOut: widget.auth.signOut,
        );
      case 1:
        return AppointmentsTab(
          controller: _homeController,
          onNavigate: _handleNavigate,
          onCheckin: _openCheckin,
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
