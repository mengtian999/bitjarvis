// SPDX-FileCopyrightText: 2019-Present Christian Kußowski
// SPDX-FileCopyrightText: Contributors to FluffyChat
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'package:bitjarvis/config/app_config.dart';
import 'package:bitjarvis/l10n/l10n.dart';
import 'package:bitjarvis/widgets/layouts/login_scaffold.dart';
import 'package:bitjarvis/widgets/matrix.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:matrix/matrix.dart'
    show AuthenticationData, AuthenticationFlow, AuthenticationTypes, MatrixException;

class RegisterPage extends StatefulWidget {
  const RegisterPage({super.key});

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _confirmPasswordController =
      TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _register() async {
    final username = _usernameController.text.trim();
    final password = _passwordController.text;
    final confirm = _confirmPasswordController.text;

    if (username.isEmpty) {
      setState(() => _error = L10n.of(context).pleaseEnterYourUsername);
      return;
    }
    if (password.isEmpty) {
      setState(() => _error = L10n.of(context).pleaseEnterYourPassword);
      return;
    }
    if (password != confirm) {
      setState(() => _error = L10n.of(context).theyDontMatch);
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final client = await Matrix.of(context).getLoginClient();
      // Ensure homeserver is the default
      client.homeserver = Uri.https(AppConfig.defaultHomeserver, '');
      await client.checkHomeserver(client.homeserver!);

      final deviceName =
          'Bit Jarvis Web ${DateTime.now().millisecondsSinceEpoch}';

      try {
        await client.register(
          username: username,
          password: password,
          initialDeviceDisplayName: deviceName,
        );
      } on MatrixException catch (e) {
        // tuwunel forces a m.login.dummy UIAA stage even for open
        // registration; complete it with the session the server returned.
        final needsDummy = e.requireAdditionalAuthentication &&
            (e.authenticationFlows ?? const <AuthenticationFlow>[])
                .any((f) => f.stages.contains(AuthenticationTypes.dummy));
        if (!needsDummy || e.session == null) {
          setState(() {
            _loading = false;
            _error = e.errorMessage;
          });
          return;
        }
        await client.register(
          username: username,
          password: password,
          initialDeviceDisplayName: deviceName,
          auth: AuthenticationData(
            type: AuthenticationTypes.dummy,
            session: e.session,
          ),
        );
      }

      if (!mounted) return;
      context.go('/backup');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = L10n.of(context);

    return LoginScaffold(
      appBar: AppBar(
        leading: _loading
            ? null
            : const Center(child: BackButton()),
        automaticallyImplyLeading: !_loading,
        title: Text(l10n.createNewAccount),
      ),
      body: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: ListView(
          children: [
            const SizedBox(height: 16),
            Center(
              child: Hero(
                tag: 'info-logo',
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(128),
                  child: Image.asset(
                    './assets/logo/mini/logo_mini.png',
                    width: 128,
                    height: 128,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _usernameController,
              autocorrect: false,
              enabled: !_loading,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.person_outlined),
                labelText: l10n.matrixId,
                hintText: l10n.pleaseEnterYourUsername,
                errorText: _error,
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _passwordController,
              autocorrect: false,
              obscureText: true,
              enabled: !_loading,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.lock_outlined),
                labelText: l10n.password,
                hintText: '******',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _confirmPasswordController,
              autocorrect: false,
              obscureText: true,
              enabled: !_loading,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.lock_outline),
                labelText: l10n.repeatPassword,
                hintText: '******',
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.colorScheme.primary,
                foregroundColor: theme.colorScheme.onPrimary,
              ),
              onPressed: _loading ? null : _register,
              child: _loading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.createNewAccount),
            ),
          ],
        ),
      ),
    );
  }
}
