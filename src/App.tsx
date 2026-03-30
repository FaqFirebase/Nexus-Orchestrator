import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { DEFAULT_CONFIG } from './constants';

import { useAuth } from './hooks/useAuth';
import { useConnection } from './hooks/useConnection';
import { useConfig } from './hooks/useConfig';
import { useConversations } from './hooks/useConversations';
import { useChat } from './hooks/useChat';

import LoginModal from './components/LoginModal';
import ChangePasswordModal from './components/ChangePasswordModal';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatTab from './components/chat/ChatTab';
import ModelsTab from './components/models/ModelsTab';
import SystemTab from './components/system/SystemTab';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'models' | 'system'>('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const auth = useAuth();

  const configHook = useConfig({
    setIsAuthorized: auth.setIsAuthorized,
    setShowLoginModal: auth.setShowLoginModal,
    checkConnection: () => connection.checkConnection(false),
  });

  const connection = useConnection({
    showLoginModal: auth.showLoginModal,
    setAuthRequired: auth.setAuthRequired,
    setIsAuthorized: auth.setIsAuthorized,
    setShowLoginModal: auth.setShowLoginModal,
    setConfig: configHook.setConfig,
    setUser: auth.setUser,
    setRegistrationEnabled: auth.setRegistrationEnabled,
  });

  const convos = useConversations();

  const chat = useChat({
    messages: convos.messages,
    setMessages: convos.setMessages,
    conversations: convos.conversations,
    activeConversationId: convos.activeConversationId,
    setActiveConversationId: convos.setActiveConversationId,
    setConversations: convos.setConversations,
    config: configHook.config,
    localModels: connection.localModels,
  });

  // Initialize on mount + 10s health check interval
  useEffect(() => {
    connection.checkConnection(true);
    convos.fetchConversations();
    convos.fetchProjects();
    const interval = setInterval(() => connection.checkConnection(false), 10000);
    return () => clearInterval(interval);
  }, [connection.checkConnection, convos.fetchConversations]);

  // Handle login — authenticate via cookie, then refresh connection
  const handleLogin = async (username: string, password: string) => {
    const success = await auth.handleLogin(username, password);
    if (success) {
      connection.checkConnection(true);
      convos.fetchConversations();
      convos.fetchProjects();
    }
    return success;
  };

  // Handle logout — clear all in-memory state before invalidating the session
  const handleLogout = useCallback(async () => {
    convos.clearAll();
    configHook.setConfig(DEFAULT_CONFIG);
    await auth.logout();
  }, [convos.clearAll, configHook.setConfig, auth.logout]);

  // Handle register — create account, auto-login, then refresh
  const handleRegister = async (username: string, password: string) => {
    const result = await auth.handleRegister(username, password);
    if (result.success) {
      connection.checkConnection(true);
      convos.fetchConversations();
      convos.fetchProjects();
    }
    return result;
  };

  return (
    <div className="h-screen flex flex-col bg-[#0A0A0A] text-zinc-300 font-sans selection:bg-emerald-500/30 overflow-hidden">
      <AnimatePresence>
        {auth.showLoginModal && (
          <LoginModal
            onLogin={handleLogin}
            onRegister={handleRegister}
            onCancel={() => auth.setShowLoginModal(false)}
            registrationEnabled={auth.registrationEnabled}
            required={!auth.isAuthorized}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showChangePassword && (
          <ChangePasswordModal
            onChangePassword={auth.changePassword}
            onClose={() => setShowChangePassword(false)}
          />
        )}
      </AnimatePresence>

      {/* Background Grid */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#141414_1px,transparent_1px),linear-gradient(to_bottom,#141414_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <Header
        connectionStatus={connection.connectionStatus}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        user={auth.user}
        onLogout={handleLogout}
        onChangePassword={() => setShowChangePassword(true)}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {!auth.isAuthorized ? null : (<>
        <AnimatePresence mode="wait">
          {isSidebarOpen && (
            <Sidebar
              conversations={convos.conversations}
              activeConversationId={convos.activeConversationId}
              onNewConversation={convos.createNewConversation}
              onSelectConversation={convos.selectConversation}
              onDeleteConversation={convos.deleteConversation}
              onRenameConversation={convos.renameConversation}
              onNavigateToChat={() => setActiveTab('chat')}
              onLoadMore={convos.loadMoreConversations}
              hasMore={convos.hasMore}
              projects={convos.projects}
              onCreateProject={convos.createProject}
              onRenameProject={convos.renameProject}
              onDeleteProject={convos.deleteProject}
              onToggleProjectCollapsed={convos.toggleProjectCollapsed}
              onAssignConversationToProject={convos.assignConversationToProject}
            />
          )}
        </AnimatePresence>

        <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
          {activeTab === 'chat' ? (
            <div className="max-w-5xl mx-auto w-full px-6 py-8 h-full flex flex-col">
              <ErrorBoundary label="Chat">
                <ChatTab
                  messages={convos.messages}
                  connectionStatus={connection.connectionStatus}
                  isLoading={chat.isLoading}
                  routingStep={chat.routingStep}
                  input={chat.input}
                  setInput={chat.setInput}
                  attachments={chat.attachments}
                  removeAttachment={chat.removeAttachment}
                  fileInputRef={chat.fileInputRef}
                  handleFileSelect={chat.handleFileSelect}
                  handleSend={chat.handleSend}
                  handleStop={chat.handleStop}
                  setActiveTab={setActiveTab}
                />
              </ErrorBoundary>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-5xl mx-auto w-full px-6 py-8">
                {activeTab === 'models' ? (
                  <ErrorBoundary label="Models">
                    <ModelsTab
                      config={configHook.config}
                      setConfig={configHook.setConfig}
                      showApiKey={configHook.showApiKey}
                      setShowApiKey={configHook.setShowApiKey}
                      saveStatus={configHook.saveStatus}
                      saveError={configHook.saveError}
                      saveConfig={configHook.saveConfig}
                      authRequired={auth.authRequired}
                      isAuthorized={auth.isAuthorized}
                      logout={handleLogout}
                      localModels={connection.localModels}
                      connectionStatus={connection.connectionStatus}
                      isLoading={chat.isLoading}
                      checkConnection={connection.checkConnection}
                      newCategoryName={configHook.newCategoryName}
                      setNewCategoryName={configHook.setNewCategoryName}
                      addCategory={configHook.addCategory}
                      removeCategory={configHook.removeCategory}
                    />
                  </ErrorBoundary>
                ) : (
                  <ErrorBoundary label="System">
                    <SystemTab
                      config={configHook.config}
                      conversations={convos.conversations}
                      fetchConversations={convos.fetchConversations}
                      onSaveConfig={configHook.saveConfig}
                      user={auth.user}
                    />
                  </ErrorBoundary>
                )}
              </div>
            </div>
          )}
        </main>
        </>)}
      </div>
    </div>
  );
}
