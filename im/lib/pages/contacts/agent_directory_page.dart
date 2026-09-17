import 'package:flutter/material.dart';

class DeviceAgentGroup {
  final String deviceId;
  final String deviceName;
  final String deviceKind; // 'desktop' | 'mobile'
  final List<RemoteAgentItem> agents;

  DeviceAgentGroup({
    required this.deviceId,
    required this.deviceName,
    required this.deviceKind,
    required this.agents,
  });
}

class RemoteAgentItem {
  final String agentId;
  final String name;
  final String yuan;
  final String uri;
  final bool isOnline;

  RemoteAgentItem({
    required this.agentId,
    required this.name,
    required this.yuan,
    required this.uri,
    this.isOnline = true,
  });
}

class AgentDirectoryPage extends StatelessWidget {
  final List<DeviceAgentGroup>? deviceGroups;
  final Function(RemoteAgentItem agent, DeviceAgentGroup device)? onSelectAgent;

  const AgentDirectoryPage({
    Key? key,
    this.deviceGroups,
    this.onSelectAgent,
  }) : super(key: key);

  List<DeviceAgentGroup> get _effectiveGroups => (deviceGroups != null && deviceGroups!.isNotEmpty)
      ? deviceGroups!
      : [
          DeviceAgentGroup(
            deviceId: 'dev_mac_01',
            deviceName: '工作站 Mac Pro (Desktop)',
            deviceKind: 'desktop',
            agents: [
              RemoteAgentItem(agentId: 'ag_flower', name: '小花 (知识库助手)', yuan: '通用', uri: 'agent://user@dev_mac_01/ag_flower', isOnline: true),
              RemoteAgentItem(agentId: 'ag_grass', name: '小草 (代码助手)', yuan: '技术', uri: 'agent://user@dev_mac_01/ag_grass', isOnline: true),
            ],
          ),
          DeviceAgentGroup(
            deviceId: 'dev_pc_02',
            deviceName: '家庭 PC (Desktop)',
            deviceKind: 'desktop',
            agents: [
              RemoteAgentItem(agentId: 'ag_tree', name: '小树 (全能 Agent)', yuan: '通用', uri: 'agent://user@dev_pc_02/ag_tree', isOnline: true),
              RemoteAgentItem(agentId: 'ag_zhao', name: '小赵 (翻译助手)', yuan: '语言', uri: 'agent://user@dev_pc_02/ag_zhao', isOnline: false),
            ],
          ),
          DeviceAgentGroup(
            deviceId: 'dev_mob_01',
            deviceName: '小米 14 Pro (Mobile)',
            deviceKind: 'mobile',
            agents: [
              RemoteAgentItem(agentId: 'ag_liu', name: '小刘 (日常助手)', yuan: '生活', uri: 'agent://user@dev_mob_01/ag_liu', isOnline: true),
              RemoteAgentItem(agentId: 'ag_wang', name: '小王 (日程管家)', yuan: '效率', uri: 'agent://user@dev_mob_01/ag_wang', isOnline: true),
            ],
          ),
        ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('多端 Agent 列表 (Agent Directory)'),
      ),
      body: ListView.builder(
        itemCount: _effectiveGroups.length,
        itemBuilder: (context, index) {
          final group = _effectiveGroups[index];
          final isMobile = group.deviceKind == 'mobile';

          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: ExpansionTile(
              leading: Icon(
                isMobile ? Icons.phone_android_rounded : Icons.desktop_windows_rounded,
                color: theme.colorScheme.primary,
              ),
              title: Text(
                group.deviceName,
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              subtitle: Text(
                '${group.agents.length} 个 Agent 人设 · ${group.deviceId}',
                style: theme.textTheme.bodySmall,
              ),
              children: group.agents.map((agent) {
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: theme.colorScheme.primaryContainer,
                    child: Text(
                      agent.name.isNotEmpty ? agent.name[0] : 'A',
                      style: TextStyle(color: theme.colorScheme.onPrimaryContainer),
                    ),
                  ),
                  title: Text(agent.name),
                  subtitle: Text(agent.uri, style: const TextStyle(fontSize: 11)),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: agent.isOnline ? Colors.green : Colors.grey,
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        icon: const Icon(Icons.chat_bubble_outline_rounded),
                        onPressed: () => onSelectAgent?.call(agent, group),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          );
        },
      ),
    );
  }
}
