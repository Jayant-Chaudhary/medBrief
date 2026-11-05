import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/core/app_theme.dart';
import 'package:health_on_patient/features/auth/auth_controller.dart';
import 'package:health_on_patient/features/home/home_page.dart';
import 'community_ui_test.dart';
import 'fake_auth_repository.dart';

// Optional actual Flutter renders, using synthetic API data only.
void main() {
  const fontDir = String.fromEnvironment('PREVIEW_FONT_DIR');
  const outputDir = String.fromEnvironment('COMMUNITY_PREVIEW_DIR');
  testWidgets('render community screens for visual review', (tester) async {
    final fonts = FontLoader('Roboto');
    for (final file in ['Roboto-Regular.ttf', 'Roboto-Bold.ttf']) {
      fonts.addFont(
        Future.value(
          ByteData.sublistView(File('$fontDir/$file').readAsBytesSync()),
        ),
      );
    }
    await fonts.load();
    await (FontLoader('MaterialIcons')..addFont(
          Future.value(
            ByteData.sublistView(
              File('$fontDir/MaterialIcons-Regular.otf').readAsBytesSync(),
            ),
          ),
        ))
        .load();
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final fixture = CommunityUiFixture();
    final repository = FakeAuthRepository()..session = true;
    final auth = AuthController(repository);
    await auth.start();
    final key = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: key,
        child: MaterialApp(
          theme: buildTheme(),
          debugShowCheckedModeBanner: false,
          home: HomePage(
            auth: auth,
            api: fixture.api,
            repository: EmptyCommunityAppointments(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(NavigationDestination, 'Community'));
    await tester.pumpAndSettle();
    Future<void> capture(String name) async {
      expect(tester.takeException(), isNull);
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {
        Directory(outputDir).createSync(recursive: true);
        final image = await boundary.toImage(pixelRatio: 2);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        File(
          '$outputDir/$name.png',
        ).writeAsBytesSync(data!.buffer.asUint8List());
        image.dispose();
      });
    }

    await capture('community-feed');
    await tester.tap(
      find.text(syntheticCommunityPosts.first['title'] as String),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Show replies'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Show replies'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Discussion'));
    await tester.pumpAndSettle();
    await capture('community-discussion');
    await tester.tap(find.byTooltip('Back to community'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Care inbox'));
    await tester.pumpAndSettle();
    await capture('community-inbox');
    await tester.tap(find.text('Private care conversation'));
    await tester.pumpAndSettle();
    await capture('community-conversation');
    await tester.tap(find.byTooltip('Back to community'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Feed'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('+ Ask'));
    await tester.pumpAndSettle();
    await capture('community-composer');
    await tester.tap(find.byTooltip('Close composer'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Choose community username'));
    await tester.pumpAndSettle();
    await capture('community-username');
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    fixture.canChooseUsername = false;
    await tester.tap(find.byTooltip('Refresh'));
    await tester.pumpAndSettle();
    await capture('community-username-locked');
    await tester.pumpWidget(const SizedBox.shrink());
    auth.dispose();
    await repository.events.close();
    fixture.api.close();
  }, skip: fontDir.isEmpty || outputDir.isEmpty);
}
