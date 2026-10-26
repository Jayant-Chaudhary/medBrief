import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/app.dart';
import 'package:health_on_patient/features/auth/auth_controller.dart';

import 'fake_auth_repository.dart';

// Optional real Flutter render for design review; ordinary tests skip it.
// flutter test test/login_preview_test.dart
//   --dart-define=PREVIEW_FONT_DIR=<flutter>/bin/cache/artifacts/material_fonts
//   --dart-define=PREVIEW_OUTPUT=/tmp/medbrief-login.png
void main() {
  const fontDir = String.fromEnvironment('PREVIEW_FONT_DIR');
  const output = String.fromEnvironment('PREVIEW_OUTPUT');
  testWidgets('render the login page for visual review', (tester) async {
    final textLoader = FontLoader('Roboto');
    for (final font in ['Roboto-Regular.ttf', 'Roboto-Bold.ttf']) {
      final bytes = File('$fontDir/$font').readAsBytesSync();
      textLoader.addFont(Future<ByteData>.value(ByteData.sublistView(bytes)));
    }
    await textLoader.load();
    final iconBytes = File(
      '$fontDir/MaterialIcons-Regular.otf',
    ).readAsBytesSync();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(Future<ByteData>.value(ByteData.sublistView(iconBytes)))).load();
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = FakeAuthRepository();
    final auth = AuthController(repository);
    await auth.start();
    final boundaryKey = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundaryKey,
        child: HealthOnApp(auth: auth),
      ),
    );
    await tester.pumpAndSettle();
    await tester.runAsync(
      () => precacheImage(
        const AssetImage('assets/logo-mark.png'),
        boundaryKey.currentContext!,
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final boundary =
        boundaryKey.currentContext!.findRenderObject()!
            as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File(output).writeAsBytesSync(bytes!.buffer.asUint8List());
      image.dispose();
    });
    await tester.pumpWidget(const SizedBox.shrink());
    auth.dispose();
    await repository.events.close();
  }, skip: fontDir.isEmpty || output.isEmpty);
}
