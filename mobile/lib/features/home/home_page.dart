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
import '../summary/summary_repository.dart';
import 'appointment_repository.dart';
import 'appointments_tab.dart';
import 'home_controller.dart';

/// The authenticated shell of the patient app.
///
/// Hosts all five core patient tabs:
///   0: Home / Appointments Dashboard
///   1: Pre-Visit Check-in
///   2: Lab Reports Library & OCR
///   3: Post-Visit Summary & Next Steps
///   4: Profile & Emergency Contacts
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

  @override
  void initState() {
    super.initState();
    final repo = widget.repository ?? AppointmentRepository(api: widget.api);
    _homeController = HomeController(
      repo: repo,
      profile: widget.auth.profile!,
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
  }

  void _handleInboxRequest() {
    if (mounted && widget.api != null) {
      _openCommunity();
    }
  }

  void _openCommunity() {
    if (widget.api == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          appBar: AppBar(title: const Text('Community')),
          body: CommunityPage(
            repository: CommunityRepository(widget.api!),
            push: widget.push,
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
    if (route == '/checkin') {
      setState(() => _tabIndex = 1);
    } else if (route == '/reports') {
      setState(() => _tabIndex = 2);
    } else if (route == '/summary') {
      setState(() => _tabIndex = 3);
    } else if (route == '/profile') {
      setState(() => _tabIndex = 4);
    } else if (route == '/community') {
      _openCommunity();
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
      appBar: _buildAppBar(),
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
            child: Image.asset('assets/logo-mark.png', excludeFromSemantics: true),
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
                _handleNavigate('/profile');
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
        return AppointmentsTab(
          controller: _homeController,
          onNavigate: _handleNavigate,
          onSignOut: widget.auth.signOut,
        );
      case 1:
        return CheckinPage(
          appointment: _homeController.activeAppointment,
          repository: widget.checkinRepository ?? CheckinRepository(api: widget.api),
          onFinished: () {
            _homeController.refresh();
            setState(() => _tabIndex = 0);
          },
        );
      case 2:
        return ReportsPage(
          controller: _reportController,
          appointments: _homeController.appointments.upcoming,
          activeAppointment: _homeController.activeAppointment,
          onSelectAppointment: (appt) => _homeController.selectAppointment(appt.id),
        );
      case 3:
        return SummaryPage(
          controller: _summaryController,
          completedAppointments: _homeController.appointments.past,
        );
      case 4:
        return ProfilePage(
          controller: _profileController,
          onSignOut: widget.auth.signOut,
        );
      default:
        return Center(
          child: Text('Tab $_tabIndex'),
        );
    }
  }

  Widget _buildBottomNav() {
    return NavigationBar(
      selectedIndex: _tabIndex,
      onDestinationSelected: (i) => setState(() => _tabIndex = i),
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
          icon: Icon(Icons.checklist_outlined),
          selectedIcon: Icon(Icons.checklist_rounded),
          label: 'Check-in',
        ),
        NavigationDestination(
          icon: Icon(Icons.description_outlined),
          selectedIcon: Icon(Icons.description_rounded),
          label: 'Reports',
        ),
        NavigationDestination(
          icon: Icon(Icons.summarize_outlined),
          selectedIcon: Icon(Icons.summarize_rounded),
          label: 'Summary',
        ),
        NavigationDestination(
          icon: Icon(Icons.person_outline_rounded),
          selectedIcon: Icon(Icons.person_rounded),
          label: 'Profile',
        ),
      ],
    );
  }
}

